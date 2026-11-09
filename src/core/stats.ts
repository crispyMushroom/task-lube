import { addDays, weekStart, type Day } from "./dates";
import { DUE_SOON_DAYS, isOpen, isPolishing, shipMode, type Data, type DayRecord, type Project, type Task } from "./model";

export interface DayStats {
  planned: number;
  done: number;
  dropped: number;
  pct: number;
}

export function dayStats(rec: DayRecord | undefined): DayStats | null {
  if (!rec || !rec.planned.length) return null;
  const planned = rec.planned.length;
  const done = rec.done.length;
  return { planned, done, dropped: rec.dropped.length, pct: done / planned };
}

/** Past recorded days where this task was planned and not done. */
export function carriedCount(data: Data, taskId: string, day: Day): number {
  let n = 0;
  for (const [d, rec] of Object.entries(data.days)) {
    if (d < day && rec.planned.includes(taskId) && !rec.done.includes(taskId)) n++;
  }
  return n;
}

export function carriedOver(data: Data, day: Day): { task: Task; count: number }[] {
  return data.tasks
    .filter((t) => isOpen(t) && !isPolishing(t) && t.scheduled && t.scheduled < day)
    .sort((a, b) => (a.scheduled! < b.scheduled! ? -1 : 1))
    .map((task) => ({ task, count: Math.max(1, carriedCount(data, task.id, day)) }));
}

/** Total estimate of the day's planned tasks (from the tasks themselves). */
export function plannedEstimate(rec: DayRecord | undefined, data: Data): { minutes: number; missing: number } {
  let minutes = 0;
  let missing = 0;
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  for (const id of rec?.planned ?? []) {
    const est = byId.get(id)?.est;
    if (est == null) missing++;
    else minutes += est;
  }
  return { minutes, missing };
}

export function habitWeek(data: Data, habitId: string, day: Day): number {
  let n = 0;
  for (let d = weekStart(day); d <= day; d = addDays(d, 1)) if (data.habitLog[d]?.includes(habitId)) n++;
  return n;
}

export function recentAverage(data: Data, day: Day, days = 30): { count: number; avg: number | null } {
  const pcts: number[] = [];
  for (let i = 1; i <= days; i++) {
    const st = dayStats(data.days[addDays(day, -i)]);
    if (st) pcts.push(st.pct);
  }
  return { count: pcts.length, avg: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null };
}

const ratio = (rs: Task[]) => rs.reduce((a, t) => a + t.took!, 0) / rs.reduce((a, t) => a + t.est!, 0);

export interface EstimateReport {
  n: number;
  ratio: number | null;
  bySize: { label: string; n: number; ratio: number }[];
  byProject: { projectId: string; n: number; ratio: number }[];
}

export function estimateReport(data: Data, day: Day, days = 30): EstimateReport {
  const since = addDays(day, -days);
  const rows = data.tasks.filter((t) => t.status === "done" && t.doneOn && t.doneOn >= since && t.est && t.took);
  const sizes: [string, (t: Task) => boolean][] = [
    ["≤30m", (t) => t.est! <= 30],
    ["1h", (t) => t.est! > 30 && t.est! <= 60],
    ["2h", (t) => t.est! > 60 && t.est! <= 120],
    ["over 2h", (t) => t.est! > 120],
  ];
  const byProject = new Map<string, Task[]>();
  for (const t of rows) if (t.projectId) byProject.set(t.projectId, [...(byProject.get(t.projectId) ?? []), t]);
  return {
    n: rows.length,
    ratio: rows.length ? ratio(rows) : null,
    bySize: sizes
      .map(([label, f]) => ({ label, rs: rows.filter(f) }))
      .filter((x) => x.rs.length)
      .map((x) => ({ label: x.label, n: x.rs.length, ratio: ratio(x.rs) })),
    byProject: [...byProject.entries()].filter(([, rs]) => rs.length >= 2).map(([projectId, rs]) => ({ projectId, n: rs.length, ratio: ratio(rs) })),
  };
}

export interface TagRow {
  tag: string;
  /** Planned tasks with this tag over the period, and how many of those were done that day. */
  planned: number;
  done: number;
  /** Tasks with this tag finished in the period. */
  finished: number;
  /** Actual / estimate for finished tasks that have both. */
  ratio: number | null;
}

/** Per-tag numbers over the last `days` days. Tasks can have several tags. */
export function tagReport(data: Data, day: Day, days = 30): TagRow[] {
  const since = addDays(day, -days);
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const rows = new Map<string, TagRow>();
  const row = (tag: string) => {
    let r = rows.get(tag);
    if (!r) rows.set(tag, (r = { tag, planned: 0, done: 0, finished: 0, ratio: null }));
    return r;
  };
  for (const [d, rec] of Object.entries(data.days)) {
    if (d < since || d >= day) continue;
    for (const id of rec.planned) {
      for (const tag of byId.get(id)?.tags ?? []) {
        row(tag).planned++;
        if (rec.done.includes(id)) row(tag).done++;
      }
    }
  }
  const finishedByTag = new Map<string, Task[]>();
  for (const t of data.tasks) {
    if (t.status !== "done" || !t.doneOn || t.doneOn < since) continue;
    for (const tag of t.tags ?? []) {
      row(tag).finished++;
      if (t.est && t.took) finishedByTag.set(tag, [...(finishedByTag.get(tag) ?? []), t]);
    }
  }
  for (const [tag, ts] of finishedByTag) row(tag).ratio = ratio(ts);
  return [...rows.values()].sort((a, b) => b.finished + b.planned - (a.finished + a.planned));
}

export function allTags(data: Data): string[] {
  return [...new Set(data.tasks.flatMap((t) => t.tags ?? []))].sort();
}

export interface ProjectSummary {
  project: Project;
  ship: boolean;
  submittable: Task[];
  submittableOpen: Task[];
  open: number;
  done: number;
}

export function projectSummary(data: Data, p: Project, day: Day): ProjectSummary {
  const tasks = data.tasks.filter((t) => t.projectId === p.id && t.status !== "dropped");
  const submittable = tasks.filter((t) => t.version === "submittable");
  return {
    project: p,
    ship: shipMode(p, day),
    submittable,
    submittableOpen: submittable.filter(isOpen),
    open: tasks.filter(isOpen).length,
    done: tasks.filter((t) => t.status === "done").length,
  };
}

/**
 * Project size over time, worked out from each task's created / done / dropped dates.
 * Deleted tasks don't count.
 */
export function projectGrowth(data: Data, projectId: string, today: Day): { day: Day; total: number; done: number }[] {
  const tasks = data.tasks.filter((t) => t.projectId === projectId);
  if (!tasks.length) return [];
  const start = tasks.map((t) => t.createdAt).sort()[0];
  const out: { day: Day; total: number; done: number }[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) {
    let total = 0;
    let done = 0;
    for (const t of tasks) {
      if (t.createdAt > d) continue;
      if (t.status === "dropped" && t.droppedOn && t.droppedOn <= d) continue;
      total++;
      if (t.status === "done" && t.doneOn && t.doneOn <= d) done++;
    }
    out.push({ day: d, total, done });
  }
  return out;
}

/**
 * Actual time recorded ("took") on tasks finished that day, and how many finished tasks have no time.
 * A deliverable's time is split: the Submittable part on the day it reached Submittable, the rest
 * on the day it finished.
 */
export function timeSpent(data: Data, day: Day): { minutes: number; missing: number } {
  let minutes = 0;
  let missing = 0;
  for (const t of data.tasks) {
    const subToday = t.submittableOn === day;
    const doneToday = t.status === "done" && t.doneOn === day;
    if (!subToday && !doneToday) continue;
    const sub = t.submittableOn ? (t.submittableTook ?? 0) : 0;
    if (subToday && t.submittableTook != null) minutes += t.submittableTook;
    if (doneToday && t.took != null) minutes += t.took - sub;
    const timed = (subToday && t.submittableTook != null) || (doneToday && t.took != null);
    if (!timed) missing++;
  }
  return { minutes, missing };
}

/**
 * "Due soon": open tasks due within DUE_SOON_DAYS (including passed due dates, until they're
 * dropped), soonest first. Tasks planned for today are left out; they're in today's plan.
 */
export function dueSoon(data: Data, day: Day): Task[] {
  const until = addDays(day, DUE_SOON_DAYS);
  return data.tasks
    .filter((t) => isOpen(t) && t.due && t.due <= until && t.scheduled !== day)
    .sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : a.order - b.order));
}

/** Tasks the app dropped automatically in the last `days` days, newest first. */
export function recentlyAutoDropped(data: Data, day: Day, days = 3): Task[] {
  const since = addDays(day, -days);
  return data.tasks
    .filter((t) => t.status === "dropped" && t.autoDropped && t.droppedOn && t.droppedOn >= since)
    .sort((a, b) => (a.droppedOn! < b.droppedOn! ? 1 : -1));
}

/** Open and total steps of a task, if it has any. */
export function stepCount(data: Data, id: string): { open: number; total: number } | null {
  const steps = data.tasks.filter((t) => t.parentId === id && t.status !== "dropped");
  return steps.length ? { open: steps.filter(isOpen).length, total: steps.length } : null;
}

/** Days a habit was done in the last `weeks` weeks (up to today), and the weekly average. */
export function habitSummary(data: Data, habitId: string, day: Day, weeks = 12): { days: number; perWeek: number } {
  let days = 0;
  for (let i = 0; i < weeks * 7; i++) if (data.habitLog[addDays(day, -i)]?.includes(habitId)) days++;
  return { days, perWeek: days / weeks };
}
