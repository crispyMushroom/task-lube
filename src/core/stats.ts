import { addDays, weekStart, type Day } from "./dates";
import { isOpen, shipMode, type Data, type DayRecord, type Project, type Task } from "./model";

export interface DayStats {
  planned: number;
  done: number;
  dropped: number;
  pct: number;
}

export function dayStats(rec: DayRecord | undefined): DayStats | null {
  if (!rec) return null;
  const planned = Object.keys(rec.planned).length;
  if (!planned) return null;
  const done = rec.done.length;
  return { planned, done, dropped: rec.dropped.length, pct: done / planned };
}

/** Past recorded days where this task was planned and not done. */
export function carriedCount(data: Data, taskId: string, day: Day): number {
  let n = 0;
  for (const [d, rec] of Object.entries(data.days)) {
    if (d < day && rec.planned[taskId] && !rec.done.includes(taskId)) n++;
  }
  return n;
}

export function carriedOver(data: Data, day: Day): { task: Task; count: number }[] {
  return data.tasks
    .filter((t) => isOpen(t) && t.scheduled && t.scheduled < day)
    .sort((a, b) => (a.scheduled! < b.scheduled! ? -1 : 1))
    .map((task) => ({ task, count: Math.max(1, carriedCount(data, task.id, day)) }));
}

export function plannedEstimate(rec: DayRecord | undefined): { minutes: number; missing: number } {
  let minutes = 0;
  let missing = 0;
  for (const p of Object.values(rec?.planned ?? {})) {
    if (p.est == null) missing++;
    else minutes += p.est;
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

export interface EstimateReport {
  n: number;
  ratio: number | null;
  bySize: { label: string; n: number; ratio: number }[];
  byProject: { projectId: string; n: number; ratio: number }[];
}

export function estimateReport(data: Data, day: Day, days = 30): EstimateReport {
  const since = addDays(day, -days);
  const rows = data.tasks.filter((t) => t.status === "done" && t.doneOn && t.doneOn >= since && t.est && t.took);
  const ratio = (rs: Task[]) => rs.reduce((a, t) => a + t.took!, 0) / rs.reduce((a, t) => a + t.est!, 0);
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

/** Project task count over time, from the daily record. */
export function projectGrowth(data: Data, projectId: string): { day: Day; total: number; done: number }[] {
  return Object.entries(data.days)
    .filter(([, rec]) => rec.counts?.[projectId])
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, rec]) => ({ day, total: rec.counts![projectId][0], done: rec.counts![projectId][1] }));
}
