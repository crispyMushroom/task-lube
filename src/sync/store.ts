import { apply, applyAll, describe, stamp, type Action, type ActionInput } from "../core/actions";
import { today } from "../core/dates";
import { emptyData, type Data } from "../core/model";
import { GitHubError, readFile, writeFile, type RepoConfig } from "./github";

export type Config = ({ mode: "github" } & RepoConfig) | { mode: "local" };

export type SyncStatus =
  | { kind: "loading" }
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "pending" }
  | { kind: "offline"; message: string }
  | { kind: "error"; message: string };

// Storage keys and the default data file name keep the app's original name ("Logger") so
// devices that were already connected stay connected.
const CONFIG_KEY = "logger.config";
const CACHE_KEY = "logger.cache";
const FLUSH_DELAY = 1200; // ms; batches quick changes into one commit
const REFRESH_EVERY = 5 * 60 * 1000;

function lsGet<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable; the app still works for this session */
  }
}

export function loadConfig(): Config | null {
  return lsGet<Config>(CONFIG_KEY);
}

export function saveConfig(c: Config | null) {
  if (c) lsSet(CONFIG_KEY, c);
  else {
    try {
      localStorage.removeItem(CONFIG_KEY);
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
}

function serialize(d: Data): string {
  return JSON.stringify(d, null, 1) + "\n";
}

function parse(text: string): Data {
  const d = JSON.parse(text);
  return { ...emptyData(), ...d, settings: { ...emptyData().settings, ...(d.settings ?? {}) } };
}

interface Cache {
  base: Data;
  sha: string | null;
  pending: Action[];
}

/**
 * Holds the data shown in the app.
 * view = base (last version known to be on GitHub) + pending actions not yet saved.
 * Saving replays pending actions on top of the latest remote version, so edits made
 * elsewhere (another device, the CLI) are never overwritten.
 */
export class Store {
  private base: Data;
  private sha: string | null = null;
  private pending: Action[] = [];
  private flushTimer: number | undefined;
  private flushing = false;
  private listeners = new Set<() => void>();
  view: Data;
  status: SyncStatus = { kind: "loading" };
  loaded = false;

  constructor(private config: Config) {
    const cache = lsGet<Cache>(CACHE_KEY);
    this.base = cache?.base ? parse(JSON.stringify(cache.base)) : emptyData();
    this.sha = cache?.sha ?? null;
    this.pending = cache?.pending ?? [];
    this.view = applyAll(this.base, this.pending);
    this.loaded = !!cache;

    window.addEventListener("online", () => this.flush());
    window.addEventListener("focus", () => this.refresh());
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && this.refresh());
    window.setInterval(() => this.refresh(), REFRESH_EVERY);
    this.refresh();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private persist() {
    lsSet(CACHE_KEY, { base: this.base, sha: this.sha, pending: this.pending } satisfies Cache);
  }

  private setStatus(s: SyncStatus) {
    this.status = s;
    this.emit();
  }

  dispatch = (input: ActionInput) => {
    const action = stamp(input);
    this.pending.push(action);
    this.view = apply(this.view, action);
    this.persist();
    this.setStatus({ kind: "pending" });
    window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => this.flush(), FLUSH_DELAY);
  };

  /** Pull the latest version from GitHub (when nothing is waiting to be saved). */
  refresh = async () => {
    if (this.config.mode === "local") {
      this.loaded = true;
      this.ensureToday();
      this.setStatus({ kind: "saved" });
      return;
    }
    if (this.flushing || this.pending.length) return this.flush();
    try {
      const remote = await readFile(this.config);
      if (remote && remote.sha !== this.sha) {
        this.base = parse(remote.text);
        this.sha = remote.sha;
        this.view = applyAll(this.base, this.pending);
        this.persist();
      } else if (!remote && !this.sha) {
        // New repo: create the file
        this.base = emptyData();
      }
      this.loaded = true;
      this.setStatus({ kind: "saved" });
      this.ensureToday(); // also creates the file on first use (lastDay is null)
    } catch (e) {
      this.loaded = true;
      this.handleError(e);
    }
  };

  /** Make sure today's record exists once a day, even if nothing is edited. */
  private ensureToday() {
    if (this.view.lastDay !== today()) this.dispatch({ type: "tick" });
  }

  flush = async () => {
    if (this.config.mode === "local") {
      this.base = this.view;
      this.pending = [];
      this.persist();
      this.setStatus({ kind: "saved" });
      return;
    }
    if (this.flushing || !this.pending.length) return;
    this.flushing = true;
    this.setStatus({ kind: "saving" });
    const config = this.config;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const batch = this.pending.slice();
        const next = applyAll(this.base, batch);
        const msg = `tl: ${describe(batch[0], this.base)}${batch.length > 1 ? ` (+${batch.length - 1} more)` : ""}`;
        try {
          this.sha = await writeFile(config, serialize(next), this.sha, msg);
          this.base = next;
          this.pending = this.pending.slice(batch.length);
          this.view = applyAll(this.base, this.pending);
          this.persist();
          break;
        } catch (e) {
          if (e instanceof GitHubError && e.isConflict && attempt < 3) {
            // Someone else saved first: take their version and replay ours on top
            const remote = await readFile(config);
            this.base = remote ? parse(remote.text) : emptyData();
            this.sha = remote?.sha ?? null;
            continue;
          }
          throw e;
        }
      }
      this.setStatus(this.pending.length ? { kind: "pending" } : { kind: "saved" });
    } catch (e) {
      this.handleError(e);
    } finally {
      this.flushing = false;
      if (this.pending.length && this.status.kind === "pending") {
        window.clearTimeout(this.flushTimer);
        this.flushTimer = window.setTimeout(() => this.flush(), FLUSH_DELAY);
      }
    }
  };

  private handleError(e: unknown) {
    if (e instanceof GitHubError) {
      this.setStatus({ kind: "error", message: e.message });
    } else {
      this.setStatus({ kind: "offline", message: "Can't reach GitHub. Changes are kept on this device and saved when you're back online." });
      window.setTimeout(() => this.flush(), 30000);
    }
  }

  get pendingCount() {
    return this.pending.length;
  }

  exportJson(): string {
    return serialize(this.view);
  }
}
