/**
 * How TaskLube data is stored: file names, the compact on-disk format, migrations,
 * and moving old history into yearly archive files.
 *
 * Files in the data repo:
 *   tasklube.json        the main ("hot") file: everything the app needs day to day
 *   archive/<year>.json  finished tasks and day records older than ARCHIVE_AFTER_DAYS
 *   logger.json          legacy (format v1). After migration it only says where the data moved,
 *                        so an outdated cached app writing to it can't damage the real data.
 */
import { addDays, toDay, type Day } from "./dates";
import { referencedIds } from "./days";
import { emptyData, SCHEMA_VERSION, type Archive, type Data, type DayRecord, type Project, type Task, type Tombstone } from "./model";

export const HOT_FILE = "tasklube.json";
export const LEGACY_FILE = "logger.json";
export const ARCHIVE_DIR = "archive";
export const ARCHIVE_AFTER_DAYS = 90;

export class NewerFormatError extends Error {
  constructor(version: number) {
    super(`This data was saved by a newer version of TaskLube (format ${version}). Reload the page to update the app; nothing will be saved until then.`);
  }
}

/** Paths of the hot file, legacy file and archive folder, next to the configured path. */
export function paths(configPath: string) {
  const dir = configPath.includes("/") ? configPath.slice(0, configPath.lastIndexOf("/") + 1) : "";
  return {
    hot: dir + HOT_FILE,
    legacy: configPath.endsWith(HOT_FILE) ? dir + LEGACY_FILE : configPath,
    archiveDir: dir + ARCHIVE_DIR,
    archiveFile: (year: string) => `${dir}${ARCHIVE_DIR}/${year}.json`,
  };
}

// ---------------------------------------------------------------- reading

function normTask(t: Partial<Task>): Task {
  return { status: "todo", version: "unsorted", order: 0, projectId: null, ...t } as Task;
}

function normDay(r: Partial<DayRecord>): DayRecord {
  return { planned: r.planned ?? [], done: r.done ?? [], dropped: r.dropped ?? [], extra: r.extra ?? [], ...(r.src ? { src: r.src } : {}) };
}

/** Convert a v1 file (day records with copied titles, ISO timestamps, per-day counts). */
function fromV1(d: any): Data {
  const tasks: Task[] = (d.tasks ?? []).map((t: any) => normTask({ ...t, createdAt: isoToDay(t.createdAt) }));
  const ids = new Set(tasks.map((t) => t.id));
  const deleted: Record<string, Tombstone> = {};
  const days: Record<Day, DayRecord> = {};
  for (const [day, r] of Object.entries<any>(d.days ?? {})) {
    for (const [id, e] of [...Object.entries<any>(r.planned ?? {}), ...Object.entries<any>(r.extra ?? {})]) {
      if (!ids.has(id)) deleted[id] = { title: e.title, projectId: e.projectId ?? null };
    }
    days[day] = normDay({
      planned: Object.keys(r.planned ?? {}).sort(),
      done: r.done ?? [],
      dropped: r.dropped ?? [],
      extra: Object.keys(r.extra ?? {}).sort(),
      ...(r.src === "backfilled" ? { src: "backfilled" as const } : {}),
    });
  }
  return {
    ...emptyData(),
    settings: { ...emptyData().settings, ...(d.settings ?? {}) },
    projects: (d.projects ?? []).map((p: any) => ({ ...p, status: p.status ?? "active", createdAt: isoToDay(p.createdAt) })),
    tasks,
    habits: d.habits ?? [],
    habitLog: d.habitLog ?? {},
    days,
    deleted,
    lastDay: d.lastDay ?? null,
  };
}

function isoToDay(v: string | undefined): Day {
  if (!v) return toDay(new Date());
  return v.length === 10 ? v : toDay(new Date(v));
}

/** Parse the main file (any known version) into the current in-memory shape. */
export function parseData(text: string): Data {
  const d = JSON.parse(text);
  const version = d.version ?? 1;
  if (version > SCHEMA_VERSION) throw new NewerFormatError(version);
  if (version < 2) return fromV1(d);
  return {
    ...emptyData(),
    ...d,
    version: SCHEMA_VERSION,
    settings: { ...emptyData().settings, ...(d.settings ?? {}) },
    projects: (d.projects ?? []).map((p: Partial<Project>) => ({ ...p, status: p.status ?? "active" })),
    tasks: (d.tasks ?? []).map(normTask),
    days: Object.fromEntries(Object.entries<Partial<DayRecord>>(d.days ?? {}).map(([k, r]) => [k, normDay(r)])),
    deleted: d.deleted ?? {},
  };
}

/** True when a legacy file has already been migrated (it only holds a pointer). */
export function isMovedStub(text: string): boolean {
  try {
    return !!JSON.parse(text).movedTo;
  } catch {
    return false;
  }
}

export function parseArchive(text: string, year: string): Archive {
  const a = JSON.parse(text);
  if ((a.version ?? 2) > SCHEMA_VERSION) throw new NewerFormatError(a.version);
  return {
    version: SCHEMA_VERSION,
    year: a.year ?? year,
    tasks: (a.tasks ?? []).map(normTask),
    days: Object.fromEntries(Object.entries<Partial<DayRecord>>(a.days ?? {}).map(([k, r]) => [k, normDay(r)])),
    habitLog: a.habitLog ?? {},
    deleted: a.deleted ?? {},
  };
}

// ---------------------------------------------------------------- writing

// Fields in a fixed, readable order (id and title first)
const TASK_KEYS: (keyof Task)[] = ["id", "title", "projectId", "parentId", "version", "status", "scheduled", "due", "est", "took", "dread", "tags", "notes", "order", "createdAt", "doneOn", "droppedOn", "by", "kind", "level", "submittableOn", "submittableTook", "dueResets", "autoDropped"];

/** Leave out values that are the default, so they don't take space. */
function compactTask(t: Task): Partial<Task> {
  const c: Record<string, unknown> = {};
  for (const k of TASK_KEYS) if (t[k] !== undefined) c[k] = t[k];
  for (const [k, v] of Object.entries(t)) if (!(k in c) && v !== undefined) c[k] = v;
  return dropDefaults(c as Partial<Task>);
}

function dropDefaults(c: Partial<Task>): Partial<Task> {
  if (c.status === "todo") delete c.status;
  if (c.version === "unsorted") delete c.version;
  if (c.order === 0) delete c.order;
  if (c.projectId === null) delete c.projectId;
  if (c.tags && !c.tags.length) delete c.tags;
  return c;
}

function compactDay(r: DayRecord): Partial<DayRecord> {
  const c: Partial<DayRecord> = {};
  if (r.planned.length) c.planned = r.planned;
  if (r.done.length) c.done = r.done;
  if (r.dropped.length) c.dropped = r.dropped;
  if (r.extra.length) c.extra = r.extra;
  if (r.src) c.src = r.src;
  return c;
}

/**
 * JSON with one item per line: each task, project, habit and day on its own line.
 * Small, but a change to one task is still one changed line in git.
 */
function lines(obj: Record<string, unknown>): string {
  const out: string[] = ["{"];
  const keys = Object.keys(obj);
  keys.forEach((k, i) => {
    const v = obj[k];
    const comma = i < keys.length - 1 ? "," : "";
    if (Array.isArray(v) && v.length && typeof v[0] === "object") {
      out.push(`${JSON.stringify(k)}: [`, v.map((x) => JSON.stringify(x)).join(",\n"), `]${comma}`);
    } else if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length && ["days", "habitLog", "deleted"].includes(k)) {
      const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
      out.push(`${JSON.stringify(k)}: {`, entries.map(([ek, ev]) => `${JSON.stringify(ek)}: ${JSON.stringify(ev)}`).join(",\n"), `}${comma}`);
    } else {
      out.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}${comma}`);
    }
  });
  out.push("}");
  return out.join("\n") + "\n";
}

export function serializeData(d: Data): string {
  return lines({
    version: SCHEMA_VERSION,
    lastDay: d.lastDay,
    settings: d.settings,
    habits: d.habits,
    projects: d.projects,
    tasks: d.tasks.map(compactTask),
    habitLog: d.habitLog,
    days: Object.fromEntries(Object.entries(d.days).map(([k, r]) => [k, compactDay(r)])),
    deleted: d.deleted,
  });
}

export function serializeArchive(a: Archive): string {
  return lines({
    version: SCHEMA_VERSION,
    year: a.year,
    tasks: a.tasks.map(compactTask),
    habitLog: a.habitLog,
    days: Object.fromEntries(Object.entries(a.days).map(([k, r]) => [k, compactDay(r)])),
    deleted: a.deleted,
  });
}

/** What the legacy logger.json becomes after migration. Readable by old app versions (v1 shape). */
export function legacyStub(): string {
  const note = "TaskLube was updated and moved your data. Close and reopen the app to see your tasks.";
  return (
    JSON.stringify(
      {
        version: 1,
        movedTo: HOT_FILE,
        settings: { capacityHours: 5 },
        projects: [],
        tasks: [{ id: "moved", projectId: null, version: "unsorted", title: note, status: "todo", order: 0, createdAt: "2026-11-06T00:00:00.000Z" }],
        habits: [],
        habitLog: {},
        days: {},
        lastDay: null,
      },
      null,
      1
    ) + "\n"
  );
}

// ---------------------------------------------------------------- archive

function emptyArchive(year: string): Archive {
  return { version: SCHEMA_VERSION, year, tasks: [], days: {}, habitLog: {}, deleted: {} };
}

/**
 * Split off history older than ARCHIVE_AFTER_DAYS: finished tasks (done/dropped, with no
 * unfinished steps under them), day records and habit-log days. Returns null if there's nothing to move.
 */
export function splitArchive(data: Data, today: Day): { hot: Data; byYear: Record<string, Archive> } | null {
  const cutoff = addDays(today, -ARCHIVE_AFTER_DAYS);
  const closedOn = (t: Task) => (t.status === "done" ? t.doneOn : t.status === "dropped" ? t.droppedOn : undefined);
  const old = new Set(data.tasks.filter((t) => (closedOn(t) ?? "9999") < cutoff).map((t) => t.id));
  // Keep a finished parent in the hot file while any of its steps stays there
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of data.tasks) if (t.parentId && old.has(t.parentId) && !old.has(t.id)) (old.delete(t.parentId), (changed = true));
  }
  const oldDays = Object.keys(data.days).filter((d) => d < cutoff);
  const oldHabitDays = Object.keys(data.habitLog).filter((d) => d < cutoff);
  if (!old.size && !oldDays.length && !oldHabitDays.length) return null;

  const byYear: Record<string, Archive> = {};
  const get = (y: string) => (byYear[y] ??= emptyArchive(y));
  for (const t of data.tasks) if (old.has(t.id)) get(closedOn(t)!.slice(0, 4)).tasks.push(t);
  for (const d of oldDays) {
    const a = get(d.slice(0, 4));
    a.days[d] = data.days[d];
    const r = data.days[d];
    for (const id of [...r.planned, ...r.extra]) if (data.deleted[id]) a.deleted[id] = data.deleted[id];
  }
  for (const d of oldHabitDays) get(d.slice(0, 4)).habitLog[d] = data.habitLog[d];

  const hotDays = Object.fromEntries(Object.entries(data.days).filter(([d]) => d >= cutoff));
  const refs = referencedIds(hotDays);
  const hot: Data = {
    ...data,
    tasks: data.tasks.filter((t) => !old.has(t.id)),
    days: hotDays,
    habitLog: Object.fromEntries(Object.entries(data.habitLog).filter(([d]) => d >= cutoff)),
    deleted: Object.fromEntries(Object.entries(data.deleted).filter(([id]) => refs.has(id))),
  };
  return { hot, byYear };
}

/** Add archived items to an existing archive file. Safe to repeat (merges by id / day). */
export function mergeArchive(existing: Archive | null, add: Archive): Archive {
  const base = existing ?? emptyArchive(add.year);
  const tasks = new Map(base.tasks.map((t) => [t.id, t]));
  for (const t of add.tasks) tasks.set(t.id, t);
  const habitLog = { ...base.habitLog };
  for (const [d, ids] of Object.entries(add.habitLog)) habitLog[d] = [...new Set([...(habitLog[d] ?? []), ...ids])].sort();
  return {
    version: SCHEMA_VERSION,
    year: add.year,
    tasks: [...tasks.values()],
    days: { ...base.days, ...add.days },
    habitLog,
    deleted: { ...base.deleted, ...add.deleted },
  };
}

/**
 * The main file plus archives, for history views (Record screen, weekly reviews).
 * The main file wins if something appears in both (e.g. after an interrupted archive).
 */
export function withHistory(hot: Data, archives: Archive[]): Data {
  if (!archives.length) return hot;
  const hotIds = new Set(hot.tasks.map((t) => t.id));
  const tasks = [...hot.tasks];
  const days: Record<Day, DayRecord> = {};
  const habitLog: Record<Day, string[]> = {};
  let deleted: Record<string, Tombstone> = {};
  for (const a of archives) {
    for (const t of a.tasks) if (!hotIds.has(t.id)) (tasks.push(t), hotIds.add(t.id));
    Object.assign(days, a.days);
    Object.assign(habitLog, a.habitLog);
    deleted = { ...deleted, ...a.deleted };
  }
  return { ...hot, tasks, days: { ...days, ...hot.days }, habitLog: { ...habitLog, ...hot.habitLog }, deleted: { ...deleted, ...hot.deleted } };
}
