import { addDays, type Day } from "./dates";
import type { Data, DayRecord, Task } from "./model";

const BACKFILL_DAYS = 14;

function entry(t: Task) {
  return { title: t.title, projectId: t.projectId, ...(t.est != null ? { est: t.est } : {}) };
}

function emptyRecord(src: DayRecord["src"]): DayRecord {
  return { planned: {}, done: [], dropped: [], extra: {}, src };
}

/**
 * Recompute done/dropped/extra for a day from current tasks.
 * live = today (states can go back and forth); otherwise only additions are kept.
 */
function settle(rec: DayRecord, day: Day, tasks: Task[], live: boolean) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const done = new Set(live ? [] : rec.done);
  const dropped = new Set(live ? [] : rec.dropped);
  for (const id of Object.keys(rec.planned)) {
    const t = byId.get(id);
    if (!t) continue;
    if (t.status === "done" && t.doneOn === day) done.add(id);
    else if (live) done.delete(id);
    if (t.status === "dropped") dropped.add(id);
    else if (live) dropped.delete(id);
  }
  rec.done = [...done].sort();
  rec.dropped = [...dropped].sort();
  const extra = live ? {} : { ...rec.extra };
  for (const t of tasks) {
    if (t.status === "done" && t.doneOn === day && !rec.planned[t.id]) extra[t.id] = { title: t.title, projectId: t.projectId };
  }
  rec.extra = extra;
}

/**
 * Bring the daily record up to date for `day` (normally today). Mutates `data`.
 * - Settles the last recorded day (catches late completions after the last update).
 * - Backfills skipped days from tasks still scheduled on them.
 * - Adds every task scheduled for `day` to its planned set. Planned only grows,
 *   so moving a task later doesn't rewrite that day. Deleted tasks are removed.
 */
export function recordDay(data: Data, day: Day): Data {
  const { tasks } = data;
  const last = data.lastDay;

  if (last && last < day) {
    if (data.days[last]) settle(data.days[last], last, tasks, false);
    let cur = addDays(last, 1);
    const floor = addDays(day, -BACKFILL_DAYS);
    if (cur < floor) cur = floor;
    while (cur < day) {
      if (!data.days[cur]) {
        const planned = tasks.filter((t) => t.scheduled === cur);
        if (planned.length) {
          const rec = emptyRecord("backfilled");
          for (const t of planned) rec.planned[t.id] = entry(t);
          settle(rec, cur, tasks, false);
          data.days[cur] = rec;
        }
      }
      cur = addDays(cur, 1);
    }
  }

  if (last && last > day) return data; // clock went backwards; don't touch the future record

  const existing = data.days[day];
  const rec = existing ?? emptyRecord("live");
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) if (t.scheduled === day) rec.planned[t.id] = entry(t);
  for (const id of Object.keys(rec.planned)) if (!ids.has(id)) delete rec.planned[id];
  // Keep titles/estimates current for tasks still scheduled today
  settle(rec, day, tasks, true);

  const counts: Record<string, [number, number]> = {};
  for (const t of tasks) {
    if (!t.projectId || t.status === "dropped") continue;
    const c = (counts[t.projectId] ??= [0, 0]);
    c[0]++;
    if (t.status === "done") c[1]++;
  }
  rec.counts = counts;

  if (existing || Object.keys(rec.planned).length || Object.keys(rec.extra).length) data.days[day] = rec;
  data.lastDay = day;
  return data;
}
