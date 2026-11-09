import { addDays, type Day } from "./dates";
import { DUE_GRACE_DAYS, isOpen, isPolishing, type Data } from "./model";

/** The day an open task past its due date gets dropped (if it isn't planned by then). */
export function autoDropDay(due: Day): Day {
  return addDays(due, DUE_GRACE_DAYS + 1);
}

/**
 * Rules that follow from due dates, applied as of `day` (the action's day, so replays match).
 * Mutates `data`.
 * - A deliverable being polished finishes at Submittable once its due date has passed.
 *   It's recorded as done on the day it reached Submittable, so no day gains a new entry.
 * - Any other open task is dropped DUE_GRACE_DAYS after its due date, unless it's planned
 *   for today or later. Its open steps go with it.
 */
export function applyDueRules(data: Data, day: Day): void {
  const droppedNow = new Set<string>();
  for (const t of data.tasks) {
    if (!isOpen(t) || !t.due || t.due >= day) continue;
    if (isPolishing(t)) {
      t.status = "done";
      t.doneOn = t.submittableOn ?? t.due;
      continue;
    }
    if (t.scheduled && t.scheduled >= day) continue;
    if (autoDropDay(t.due) <= day) {
      t.status = "dropped";
      t.droppedOn = autoDropDay(t.due);
      t.autoDropped = true;
      droppedNow.add(t.id);
    }
  }
  // Open steps of a dropped task go with it (steps with their own due date follow their own)
  let grew = droppedNow.size > 0;
  while (grew) {
    grew = false;
    for (const t of data.tasks) {
      if (t.parentId && droppedNow.has(t.parentId) && isOpen(t) && !t.due && !(t.scheduled && t.scheduled >= day)) {
        t.status = "dropped";
        t.droppedOn = data.tasks.find((p) => p.id === t.parentId)!.droppedOn;
        t.autoDropped = true;
        droppedNow.add(t.id);
        grew = true;
      }
    }
  }
}
