import type { Day } from "./dates";

export type ProjectStatus = "active" | "paused" | "submitted" | "done" | "dropped";
export type TaskStatus = "todo" | "doing" | "done" | "dropped";
/** Which version of the project a task belongs to. "unsorted" = not decided yet. */
export type Version = "submittable" | "good" | "stretch" | "v2" | "unsorted";

export const VERSIONS: { id: Version; label: string; hint: string }[] = [
  { id: "submittable", label: "Submittable", hint: "The bare minimum you'd actually turn in" },
  { id: "good", label: "Good", hint: "" },
  { id: "stretch", label: "Stretch", hint: "" },
  { id: "unsorted", label: "To sort", hint: "Not assigned to a version yet" },
  { id: "v2", label: "v2 / after submission", hint: "Ideas that come up during ship mode" },
];

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  goal?: string;
  notes?: string;
  links?: string;
  deadline?: Day;
  /** Submittable version due. Ship mode runs from here until the deadline. */
  internalDeadline?: Day;
  wrapup?: { planned?: string; happened?: string; grew?: string };
  createdAt: Day;
  /** "claude" when created by Claude (through the CLI). */
  by?: string;
}

export interface Task {
  id: string;
  /** null = inbox */
  projectId: string | null;
  parentId?: string;
  version: Version;
  title: string;
  notes?: string;
  status: TaskStatus;
  scheduled?: Day;
  due?: Day;
  est?: number; // minutes
  took?: number; // minutes
  dread?: number; // 1-5
  order: number;
  /** Free-form categories, e.g. "writing", "research". For grouping stats. */
  tags?: string[];
  createdAt: Day;
  doneOn?: Day;
  droppedOn?: Day;
  /** "claude" when created by Claude (through the CLI). */
  by?: string;
}

export interface Habit {
  id: string;
  name: string;
  target: number; // per week
  archived?: boolean;
}

/** Data format version. Bump with a migration in core/format.ts when the shape changes. */
export const SCHEMA_VERSION = 2;

/**
 * What was planned and done on one day, as task ids. "planned" only grows during the day.
 * Titles etc. come from the task itself (or from `deleted` if it was deleted later).
 */
export interface DayRecord {
  planned: string[];
  done: string[];
  dropped: string[];
  /** Done that day without being planned for that day. */
  extra: string[];
  /** Set when the day was reconstructed later because the app wasn't used that day. */
  src?: "backfilled";
}

/** Minimal info kept for deleted tasks that appear in the daily record. */
export interface Tombstone {
  title: string;
  projectId: string | null;
}

export interface Data {
  version: number;
  settings: { capacityHours: number };
  projects: Project[];
  tasks: Task[];
  habits: Habit[];
  /** day -> habit ids done that day */
  habitLog: Record<Day, string[]>;
  days: Record<Day, DayRecord>;
  /** Deleted tasks still referenced by day records. */
  deleted: Record<string, Tombstone>;
  /** Last day the record was updated. */
  lastDay: Day | null;
}

/** Older history moved out of the main file: one per year (archive/<year>.json). */
export interface Archive {
  version: number;
  year: string;
  tasks: Task[];
  days: Record<Day, DayRecord>;
  habitLog: Record<Day, string[]>;
  deleted: Record<string, Tombstone>;
}

export function emptyData(): Data {
  return {
    version: SCHEMA_VERSION,
    settings: { capacityHours: 5 },
    projects: [],
    tasks: [],
    habits: [],
    habitLog: {},
    days: {},
    deleted: {},
    lastDay: null,
  };
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Title and project for any task id: live, archived (if merged in), or deleted. */
export function taskInfo(data: Data, id: string): { title: string; projectId: string | null; task?: Task } {
  const task = data.tasks.find((t) => t.id === id);
  if (task) return { title: task.title, projectId: task.projectId, task };
  const gone = data.deleted[id];
  return gone ? { ...gone } : { title: "(unknown task)", projectId: null };
}

export function isOpen(t: Task): boolean {
  return t.status === "todo" || t.status === "doing";
}

export function shipMode(p: Project, day: Day): boolean {
  return p.status === "active" && !!p.internalDeadline && !!p.deadline && day >= p.internalDeadline && day <= p.deadline;
}

/** "15m", "1h", "1.5h", "2h30m", "90", "45 min" -> minutes. Bare numbers are minutes. */
export function parseDuration(s: string | undefined | null): number | undefined {
  if (s == null) return undefined;
  const v = String(s).trim().replace(/^~/, "").toLowerCase();
  if (!v) return undefined;
  let m = v.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?(?:\s*(\d+)\s*m(?:in)?)?$/);
  if (m) return Math.round(parseFloat(m[1]) * 60 + (m[2] ? parseInt(m[2], 10) : 0));
  m = v.match(/^(\d+)\s*(?:m|min|mins|minutes?)?$/);
  if (m) return parseInt(m[1], 10);
  return undefined;
}

export function fmtMinutes(min: number | undefined): string {
  if (min == null) return "";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (!r) return `${h}h`;
  if (r === 30) return `${h}.5h`;
  return `${h}h${r}m`;
}
