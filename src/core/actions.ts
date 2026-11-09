import { today as todayOf, type Day } from "./dates";
import { canBackdate, recordDay, referencedIds, resettlePastDay } from "./days";
import { applyDueRules, autoDropDay } from "./due";
import { isOpen, isPastDue, isPolishing, newId, type Data, type Habit, type Level, type Project, type Task } from "./model";

/**
 * Every change to the data is an action. The app and the CLI both apply actions through
 * `apply`, so the daily record stays consistent no matter who made the change.
 * `at` is an ISO timestamp; the day it falls on is the day being recorded.
 * `setStatus.on` logs a completion on an earlier day instead (for tasks checked off late), and
 * with any other status takes the task off that day's record. It's ignored unless the day is
 * before `at` and at most MAX_BACKDATE_DAYS back.
 * `setLevel` moves a deliverable to Submittable (stays open for polishing) or Good (finished),
 * or with `null` back to not started. `on` works as for setStatus.
 * After every action, `applyDueRules` drops or finishes tasks whose due date has passed (due.ts).
 */
export type Action =
  | { type: "addTask"; at: string; task: Partial<Task> & { title: string } }
  | { type: "updateTask"; at: string; id: string; patch: Partial<Omit<Task, "id">> }
  | { type: "setStatus"; at: string; id: string; status: Task["status"]; took?: number; on?: Day }
  | { type: "setLevel"; at: string; id: string; level: Level | null; took?: number; on?: Day }
  | { type: "deleteTask"; at: string; id: string }
  | { type: "addProject"; at: string; project: Partial<Project> & { name: string } }
  | { type: "updateProject"; at: string; id: string; patch: Partial<Omit<Project, "id">> }
  | { type: "deleteProject"; at: string; id: string }
  | { type: "toggleHabit"; at: string; habitId: string; day?: Day }
  | { type: "addHabit"; at: string; habit: Partial<Habit> & { name: string; target: number } }
  | { type: "updateHabit"; at: string; id: string; patch: Partial<Omit<Habit, "id">> }
  | { type: "updateSettings"; at: string; patch: Partial<Data["settings"]> }
  | { type: "tick"; at: string };

export type ActionInput = Action extends infer A ? (A extends { at: string } ? Omit<A, "at"> & { at?: string } : never) : never;

/**
 * Fill in the timestamp, and ids for new items, once, when the action is created.
 * Actions get replayed (after a save conflict), so `apply` must not invent ids or times itself.
 */
export function stamp(a: ActionInput, now: Date = new Date()): Action {
  const s = { ...a, at: a.at ?? now.toISOString() } as Action;
  if (s.type === "addTask" && !s.task.id) s.task = { ...s.task, id: newId("t") };
  if (s.type === "addProject" && !s.project.id) s.project = { ...s.project, id: newId("p") };
  if (s.type === "addHabit" && !s.habit.id) s.habit = { ...s.habit, id: newId("h") };
  return s;
}

function dayOf(iso: string): Day {
  return todayOf(new Date(iso));
}

function nextOrder(data: Data, projectId: string | null): number {
  const orders = data.tasks.filter((t) => t.projectId === projectId).map((t) => t.order);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

function clean<T extends object>(o: T): T {
  // Drop keys set to undefined or "" so the JSON stays tidy
  for (const k of Object.keys(o) as (keyof T)[]) {
    if (o[k] === undefined || (o[k] as unknown) === "") delete o[k];
  }
  return o;
}

/**
 * Reopening a task the due rules would close straight away (a polished deliverable past its
 * due date, or a task past its drop day) gives it a new due date of today, counted as a reset.
 */
function reopenPastDue(t: Task, day: Day) {
  if (!isOpen(t) || !t.due) return;
  const closes = isPolishing(t) ? t.due < day : autoDropDay(t.due) <= day && !(t.scheduled && t.scheduled >= day);
  if (closes) {
    t.due = day;
    t.dueResets = (t.dueResets ?? 0) + 1;
  }
}

/** Apply one action. Returns a new Data object (input is not mutated). */
export function apply(input: Data, action: Action): Data {
  const data: Data = structuredClone(input);
  const day = dayOf(action.at);

  switch (action.type) {
    case "addTask": {
      const t = action.task;
      if (t.id && data.tasks.some((x) => x.id === t.id)) break; // already added (e.g. a retried save)
      const projectId = t.projectId ?? null;
      data.tasks.push(
        clean({
          version: "unsorted",
          status: "todo",
          order: nextOrder(data, projectId),
          ...t,
          projectId,
          id: t.id ?? newId("t"),
          title: t.title.trim(),
          createdAt: day,
        } as Task)
      );
      break;
    }
    case "updateTask": {
      const t = data.tasks.find((x) => x.id === action.id);
      if (!t) break;
      const pastDue = isPastDue(t, day);
      const oldDue = t.due;
      Object.assign(t, action.patch);
      clean(t);
      if (pastDue) {
        // A passed due date that's moved or cleared, or planning the task (which moves the due
        // date to the planned day), counts as a reset. The count stays visible on the task.
        if ("due" in action.patch) {
          if (t.due !== oldDue) t.dueResets = (t.dueResets ?? 0) + 1;
        } else if ("scheduled" in action.patch && t.scheduled && t.scheduled >= day) {
          t.due = t.scheduled;
          t.dueResets = (t.dueResets ?? 0) + 1;
        }
      }
      if (t.kind !== "deliverable") {
        delete t.level;
        delete t.submittableOn;
        delete t.submittableTook;
      }
      break;
    }
    case "setStatus": {
      const t = data.tasks.find((x) => x.id === action.id);
      if (!t) break;
      const wasDone = t.status === "done";
      t.status = action.status;
      delete t.doneOn;
      delete t.droppedOn;
      delete t.autoDropped;
      if (action.status === "done") t.doneOn = canBackdate(action.on, day) ? action.on : day;
      if (action.status === "dropped") t.droppedOn = day;
      if (t.kind === "deliverable" && isOpen(t) && wasDone) {
        // Reopening a finished deliverable goes back to polishing if it reached Submittable
        if (t.submittableOn) {
          t.level = "submittable";
          if (t.submittableTook != null) t.took = t.submittableTook;
        } else delete t.level;
      }
      if (action.took != null) {
        // A deliverable's time adds up over its steps
        const before = action.status === "done" && t.kind === "deliverable" && t.submittableOn ? (t.submittableTook ?? 0) : 0;
        t.took = before + action.took;
      }
      reopenPastDue(t, day);
      break;
    }
    case "setLevel": {
      const t = data.tasks.find((x) => x.id === action.id);
      if (!t) break;
      const on = canBackdate(action.on, day) ? action.on : day;
      if (action.level === null) {
        if (t.submittableTook != null && t.took === t.submittableTook) delete t.took;
        delete t.level;
        delete t.submittableOn;
        delete t.submittableTook;
        if (t.status === "done") {
          t.status = "todo";
          delete t.doneOn;
        }
        break;
      }
      t.kind = "deliverable";
      delete t.droppedOn;
      delete t.autoDropped;
      if (action.level === "submittable") {
        t.level = "submittable";
        t.submittableOn = on;
        if (action.took != null) t.took = t.submittableTook = action.took;
        if (!isOpen(t)) t.status = "todo";
        delete t.doneOn;
        // Past its due date there's no time left to polish; applyDueRules finishes it at Submittable
      } else {
        const before = t.submittableOn ? (t.submittableTook ?? 0) : 0;
        t.level = "good";
        t.status = "done";
        t.doneOn = on;
        if (action.took != null) t.took = before + action.took;
      }
      break;
    }
    case "deleteTask": {
      const remove = new Set([action.id]);
      // also remove subtasks
      let grew = true;
      while (grew) {
        grew = false;
        for (const t of data.tasks) if (t.parentId && remove.has(t.parentId) && !remove.has(t.id)) (remove.add(t.id), (grew = true));
      }
      // Keep a title for deleted tasks the daily record still refers to
      const refs = referencedIds(data.days);
      for (const t of data.tasks) if (remove.has(t.id) && refs.has(t.id)) data.deleted[t.id] = { title: t.title, projectId: t.projectId };
      data.tasks = data.tasks.filter((t) => !remove.has(t.id));
      break;
    }
    case "addProject": {
      if (action.project.id && data.projects.some((x) => x.id === action.project.id)) break;
      data.projects.push(clean({ status: "active", ...action.project, id: action.project.id ?? newId("p"), createdAt: day } as Project));
      break;
    }
    case "updateProject": {
      const p = data.projects.find((x) => x.id === action.id);
      if (!p) break;
      Object.assign(p, action.patch);
      clean(p);
      break;
    }
    case "deleteProject": {
      data.projects = data.projects.filter((p) => p.id !== action.id);
      // Tasks go back to the inbox rather than disappearing
      for (const t of data.tasks) if (t.projectId === action.id) (t.projectId = null), (t.version = "unsorted");
      break;
    }
    case "toggleHabit": {
      const d = action.day ?? day;
      const set = new Set(data.habitLog[d] ?? []);
      if (set.has(action.habitId)) set.delete(action.habitId);
      else set.add(action.habitId);
      if (set.size) data.habitLog[d] = [...set].sort();
      else delete data.habitLog[d];
      break;
    }
    case "addHabit": {
      if (action.habit.id && data.habits.some((x) => x.id === action.habit.id)) break;
      data.habits.push({ ...action.habit, id: action.habit.id ?? newId("h") } as Habit);
      break;
    }
    case "updateHabit": {
      const h = data.habits.find((x) => x.id === action.id);
      if (h) Object.assign(h, action.patch);
      break;
    }
    case "updateSettings": {
      Object.assign(data.settings, action.patch);
      break;
    }
    case "tick":
      break;
  }

  applyDueRules(data, day);
  recordDay(data, day);
  if ((action.type === "setStatus" || action.type === "setLevel") && canBackdate(action.on, day)) resettlePastDay(data, action.on, action.id);
  if (action.type === "deleteTask") {
    // A task deleted on the day it was planned isn't in the record anymore; drop its tombstone
    const refs = referencedIds(data.days);
    for (const id of Object.keys(data.deleted)) if (!refs.has(id)) delete data.deleted[id];
  }
  return data;
}

export function applyAll(data: Data, actions: Action[]): Data {
  return actions.reduce(apply, data);
}

/** One-line description, used for commit messages. */
export function describe(a: Action, data?: Data): string {
  const title = (id: string) => data?.tasks.find((t) => t.id === id)?.title ?? id;
  switch (a.type) {
    case "addTask":
      return `add task "${a.task.title}"`;
    case "updateTask":
      return `edit "${title(a.id)}" (${Object.keys(a.patch).join(", ")})`;
    case "setStatus":
      return `${a.status} "${title(a.id)}"${a.on ? ` (for ${a.on})` : ""}`;
    case "setLevel":
      return `${a.level ?? "not started"} "${title(a.id)}"${a.on ? ` (for ${a.on})` : ""}`;
    case "deleteTask":
      return `delete "${title(a.id)}"`;
    case "addProject":
      return `add project "${a.project.name}"`;
    case "updateProject":
      return `edit project (${Object.keys(a.patch).join(", ")})`;
    case "deleteProject":
      return "delete project";
    case "toggleHabit":
      return "log habit";
    case "addHabit":
      return `add habit "${a.habit.name}"`;
    case "updateHabit":
      return "edit habit";
    case "updateSettings":
      return "edit settings";
    case "tick":
      return "update daily record";
  }
}
