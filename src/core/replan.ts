import { addDays, type Day } from "./dates";
import { isOpen, isPolishing, type Data, type Task } from "./model";

/** Tasks without an estimate take this much room when a plan is restarted. */
export const REPLAN_DEFAULT_EST = 30;

export interface PlanMove {
  id: string;
  from: Day;
  to: Day;
}

export interface Replan {
  /** Tasks whose planned day changes. */
  moves: PlanMove[];
  /** The last planned day of the project's open tasks afterwards. */
  last: Day | null;
  /** Estimated minutes per day for days that gain tasks (including what was already there). */
  load: Record<Day, number>;
  /** Moved tasks that had no estimate (counted as REPLAN_DEFAULT_EST). */
  unestimated: number;
}

/** The project's open, planned tasks in plan order: by planned day, then by their order. */
export function plannedInOrder(data: Data, projectId: string): Task[] {
  return data.tasks
    .filter((t) => t.projectId === projectId && isOpen(t) && !isPolishing(t) && t.scheduled)
    .sort((a, b) => a.scheduled!.localeCompare(b.scheduled!) || a.order - b.order);
}

/**
 * Restart a project's plan from `start`. Project tasks often depend on each other, so when the
 * plan slips, the later tasks move with it instead of each being carried over on its own.
 * - Order is kept: a task never lands before one that came before it in the plan.
 * - Tasks planned before `start` (or pushed by an earlier one) move to the first day with room,
 *   filling each day up to the capacity guideline, counting work already planned that day.
 *   A day with nothing on it always takes the next task, however big.
 * - Tasks that don't need to move keep their day, even if it's over the guideline.
 * Pure: returns the moves; the `replan` action applies them.
 */
export function restartPlan(data: Data, projectId: string, start: Day): Replan {
  const capacity = data.settings.capacityHours * 60;
  const plan = plannedInOrder(data, projectId);
  const inPlan = new Set(plan.map((t) => t.id));
  const size = (t: Task) => t.est ?? REPLAN_DEFAULT_EST;

  // Work already planned from `start` on: other tasks, plus this plan's tasks where they are now
  const load = new Map<Day, number>();
  const add = (d: Day, m: number) => load.set(d, (load.get(d) ?? 0) + m);
  for (const t of data.tasks) {
    if (!isOpen(t) || isPolishing(t) || !t.scheduled || t.scheduled < start) continue;
    if (!inPlan.has(t.id)) add(t.scheduled, t.est ?? 0);
    else add(t.scheduled, size(t));
  }

  const moves: PlanMove[] = [];
  const touched = new Set<Day>();
  let cursor = start;
  let unestimated = 0;
  for (const t of plan) {
    const from = t.scheduled!;
    if (from >= cursor) {
      cursor = from; // stays where it is
      continue;
    }
    if (from >= start) add(from, -size(t)); // pushed out of its day by an earlier task
    let d = cursor;
    while ((load.get(d) ?? 0) > 0 && (load.get(d) ?? 0) + size(t) > capacity) d = addDays(d, 1);
    add(d, size(t));
    touched.add(d);
    moves.push({ id: t.id, from, to: d });
    if (t.est == null) unestimated++;
    cursor = d;
  }

  const days: Record<Day, number> = {};
  for (const d of [...touched].sort()) days[d] = load.get(d) ?? 0;
  return { moves, last: plan.length ? cursor : null, load: days, unestimated };
}
