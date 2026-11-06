import { addDays, type Day } from "./dates";
import type { Data, DayRecord, Task } from "./model";

const BACKFILL_DAYS = 14;

function emptyRecord(): DayRecord {
  return { planned: [], done: [], dropped: [], extra: [] };
}

/**
 * Recompute done/dropped/extra for a day from current tasks.
 * live = today (states can go back and forth); otherwise only additions are kept.
 */
function settle(rec: DayRecord, day: Day, tasks: Task[], live: boolean) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const done = new Set(live ? [] : rec.done);
  const dropped = new Set(live ? [] : rec.dropped);
  for (const id of rec.planned) {
    const t = byId.get(id);
    if (!t) continue;
    if (t.status === "done" && t.doneOn === day) done.add(id);
    else if (live) done.delete(id);
    if (t.status === "dropped") dropped.add(id);
    else if (live) dropped.delete(id);
  }
  rec.done = [...done].sort();
  rec.dropped = [...dropped].sort();
  const planned = new Set(rec.planned);
  const extra = new Set(live ? [] : rec.extra);
  for (const t of tasks) if (t.status === "done" && t.doneOn === day && !planned.has(t.id)) extra.add(t.id);
  rec.extra = [...extra].sort();
}

/**
 * Bring the daily record up to date for `day` (normally today). Mutates `data`.
 * - Settles the last recorded day (catches late completions after the last update).
 * - Backfills skipped days from tasks still scheduled on them.
 * - Adds every task scheduled for `day` to its planned set. Planned only grows,
 *   so moving a task later doesn't rewrite that day. Tasks deleted today are removed.
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
          const rec: DayRecord = { ...emptyRecord(), planned: planned.map((t) => t.id).sort(), src: "backfilled" };
          settle(rec, cur, tasks, false);
          data.days[cur] = rec;
        }
      }
      cur = addDays(cur, 1);
    }
  }

  if (last && last > day) return data; // clock went backwards; don't touch the future record

  const existing = data.days[day];
  const rec = existing ?? emptyRecord();
  const ids = new Set(tasks.map((t) => t.id));
  const planned = new Set(rec.planned.filter((id) => ids.has(id)));
  for (const t of tasks) if (t.scheduled === day) planned.add(t.id);
  rec.planned = [...planned].sort();
  settle(rec, day, tasks, true);

  if (existing || rec.planned.length || rec.extra.length) data.days[day] = rec;
  data.lastDay = day;
  return data;
}

/** Ids referenced by any day record. */
export function referencedIds(days: Record<Day, DayRecord>): Set<string> {
  const s = new Set<string>();
  for (const r of Object.values(days)) for (const list of [r.planned, r.done, r.dropped, r.extra]) for (const id of list) s.add(id);
  return s;
}
