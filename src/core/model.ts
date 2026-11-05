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
  createdAt: string; // ISO timestamp
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
  createdAt: string; // ISO
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

export interface PlannedEntry {
  title: string;
  projectId: string | null;
  est?: number;
}

/** What was planned and done on one day. "planned" only grows during the day. */
export interface DayRecord {
  planned: Record<string, PlannedEntry>;
  done: string[];
  dropped: string[];
  /** Done that day without being planned for that day. */
  extra: Record<string, { title: string; projectId: string | null }>;
  /** "backfilled" = reconstructed later because the app wasn't used that day. */
  src: "live" | "backfilled";
  /** Per project: [open+done task count, done count]. For growth charts. */
  counts?: Record<string, [number, number]>;
}

export interface Data {
  version: 1;
  settings: { capacityHours: number };
  projects: Project[];
  tasks: Task[];
  habits: Habit[];
  /** day -> habit ids done that day */
  habitLog: Record<Day, string[]>;
  days: Record<Day, DayRecord>;
  /** Last day the record was updated. */
  lastDay: Day | null;
}

export function emptyData(): Data {
  return {
    version: 1,
    settings: { capacityHours: 5 },
    projects: [],
    tasks: [],
    habits: [],
    habitLog: {},
    days: {},
    lastDay: null,
  };
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
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
