import { apply, applyAll, describe, stamp, type Action, type ActionInput } from "../core/actions";
import { today } from "../core/dates";
import {
  isMovedStub,
  legacyStub,
  mergeArchive,
  NewerFormatError,
  parseArchive,
  parseData,
  paths,
  serializeArchive,
  serializeData,
  splitArchive,
  withHistory,
} from "../core/format";
import { emptyData, type Archive, type Data } from "../core/model";
import { GitHubError, listDir, readFile, writeFile, type RepoConfig } from "./github";

export type Config = ({ mode: "github" } & RepoConfig) | { mode: "local" };

export type SyncStatus =
  | { kind: "loading" }
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "pending" }
  | { kind: "offline"; message: string }
  | { kind: "error"; message: string };

// Storage keys keep the app's original name ("Logger") so connected devices stay connected.
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
 *
 * Files: the main file (tasklube.json) is read and written on every change. Older history
 * lives in archive/<year>.json and is only loaded for history views (see core/format.ts).
 */
export class Store {
  private base: Data;
  private sha: string | null = null;
  private pending: Action[] = [];
  private flushTimer: number | undefined;
  private flushing = false;
  /** Set when the remote data is in a newer format than this app understands. */
  private blocked = false;
  private archivedOn: string | null = null;
  private archives: Archive[] | null = null;
  private archivesLoading: Promise<void> | null = null;
  private historyCache: { view: Data; archives: Archive[]; merged: Data } | null = null;
  private listeners = new Set<() => void>();
  view: Data;
  status: SyncStatus = { kind: "loading" };
  loaded = false;

  constructor(private config: Config) {
    const cache = lsGet<Cache>(CACHE_KEY);
    let base = emptyData();
    try {
      if (cache?.base) base = parseData(JSON.stringify(cache.base));
    } catch {
      /* unreadable cache: start from GitHub */
    }
    this.base = base;
    this.sha = cache?.base && (cache.base as Data).version === base.version ? (cache?.sha ?? null) : null;
    this.pending = cache?.pending ?? [];
    this.view = applyAll(this.base, this.pending);
    this.loaded = !!cache;

    window.addEventListener("online", () => this.flush());
    window.addEventListener("focus", () => this.refresh());
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && this.refresh());
    window.setInterval(() => this.refresh(), REFRESH_EVERY);
    this.refresh();
  }

  private get files() {
    return paths(this.config.mode === "github" ? this.config.path : "tasklube.json");
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

  /** Read the main file, moving data over from the legacy file the first time. */
  private async readHot(config: RepoConfig): Promise<{ data: Data; sha: string } | null> {
    const f = this.files;
    let remote = await readFile(config, f.hot);
    if (!remote) {
      const legacy = f.legacy !== f.hot ? await readFile(config, f.legacy) : null;
      if (legacy && !isMovedStub(legacy.text)) {
        // First run of this version: write the data in the new format, then leave a pointer
        // in the old file so outdated app copies can't overwrite the real data.
        const data = parseData(legacy.text);
        try {
          await writeFile(config, f.hot, serializeData(data), null, "tl: move data to tasklube.json (compact format)");
        } catch (e) {
          if (!(e instanceof GitHubError && e.isConflict)) throw e; // someone else migrated first
        }
        await writeFile(config, f.legacy, legacyStub(), legacy.sha, "tl: point the old logger.json at tasklube.json").catch(() => {});
        remote = await readFile(config, f.hot);
      }
    }
    return remote ? { data: parseData(remote.text), sha: remote.sha } : null;
  }

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
      const remote = await this.readHot(this.config);
      if (remote && remote.sha !== this.sha) {
        this.base = remote.data;
        this.sha = remote.sha;
        this.view = applyAll(this.base, this.pending);
        this.persist();
      } else if (!remote && !this.sha) {
        this.base = emptyData(); // new repo: the file gets created by the first save
      }
      this.blocked = false;
      this.loaded = true;
      this.setStatus({ kind: "saved" });
      this.ensureToday();
      void this.maybeArchive();
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
    if (this.flushing || !this.pending.length || this.blocked) return;
    this.flushing = true;
    this.setStatus({ kind: "saving" });
    const config = this.config;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const batch = this.pending.slice();
        const next = applyAll(this.base, batch);
        const msg = `tl: ${describe(batch[0], this.base)}${batch.length > 1 ? ` (+${batch.length - 1} more)` : ""}`;
        try {
          this.sha = await writeFile(config, this.files.hot, serializeData(next), this.sha, msg);
          this.base = next;
          this.pending = this.pending.slice(batch.length);
          this.view = applyAll(this.base, this.pending);
          this.persist();
          break;
        } catch (e) {
          if (e instanceof GitHubError && e.isConflict && attempt < 3) {
            // Someone else saved first: take their version and replay ours on top
            const remote = await this.readHot(config);
            this.base = remote?.data ?? emptyData();
            this.sha = remote?.sha ?? null;
            continue;
          }
          throw e;
        }
      }
      this.setStatus(this.pending.length ? { kind: "pending" } : { kind: "saved" });
      if (!this.pending.length) void this.maybeArchive();
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

  /**
   * At most once a day: move history older than 90 days into archive/<year>.json.
   * Archive files are written first and the main file second; if anything fails in between,
   * the items are in both places, and the main file's copy wins when reading.
   */
  private async maybeArchive() {
    if (this.config.mode !== "github" || this.blocked || this.flushing || this.pending.length) return;
    const day = today();
    if (this.archivedOn === day) return;
    const split = splitArchive(this.base, day);
    this.archivedOn = day;
    if (!split) return;
    const config = this.config;
    try {
      for (const [year, add] of Object.entries(split.byYear)) {
        const path = this.files.archiveFile(year);
        for (let attempt = 0; attempt < 3; attempt++) {
          const existing = await readFile(config, path);
          const merged = mergeArchive(existing ? parseArchive(existing.text, year) : null, add);
          try {
            await writeFile(config, path, serializeArchive(merged), existing?.sha ?? null, `tl: archive history from ${year}`);
            break;
          } catch (e) {
            if (!(e instanceof GitHubError && e.isConflict) || attempt === 2) throw e;
          }
        }
      }
      if (this.pending.length || this.flushing) return; // the next save will archive again
      this.sha = await writeFile(config, this.files.hot, serializeData(split.hot), this.sha, "tl: move older history to the archive");
      this.base = split.hot;
      this.view = applyAll(this.base, this.pending);
      this.archives = null; // reload on next history view
      this.historyCache = null;
      this.persist();
      this.emit();
    } catch {
      this.archivedOn = null; // try again later; nothing is lost either way
    }
  }

  /** Load archive files (once) for history views. */
  ensureHistory = () => {
    if (this.archives || this.archivesLoading) return;
    if (this.config.mode !== "github") {
      this.archives = [];
      return;
    }
    const config = this.config;
    this.archivesLoading = (async () => {
      try {
        const names = await listDir(config, this.files.archiveDir);
        const out: Archive[] = [];
        for (const name of names.filter((n) => /^\d{4}\.json$/.test(n)).sort()) {
          const year = name.slice(0, 4);
          const f = await readFile(config, this.files.archiveFile(year));
          if (f) out.push(parseArchive(f.text, year));
        }
        this.archives = out;
      } catch {
        this.archives = [];
      } finally {
        this.archivesLoading = null;
        this.historyCache = null;
        this.emit();
      }
    })();
  };

  /** Current data plus archived history (archives may still be loading). */
  history = (): Data => {
    const archives = this.archives ?? [];
    const c = this.historyCache;
    if (c && c.view === this.view && c.archives === archives) return c.merged;
    const merged = withHistory(this.view, archives);
    this.historyCache = { view: this.view, archives, merged };
    return merged;
  };

  get historyLoading() {
    return !this.archives;
  }

  private handleError(e: unknown) {
    if (e instanceof NewerFormatError) {
      this.blocked = true;
      this.setStatus({ kind: "error", message: e.message });
    } else if (e instanceof GitHubError) {
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
    return serializeData(this.history());
  }
}
