import { describe, expect, it } from "vitest";
import { apply, applyAll, type Action } from "./actions";
import { isoWeek, weekStart } from "./dates";
import { MAX_BACKDATE_DAYS } from "./days";
import { restartPlan } from "./replan";
import { ARCHIVE_AFTER_DAYS } from "./format";
import { emptyData, fmtMinutes, isPolishing, parseDuration, type Data } from "./model";
import { carriedCount, carriedOver, dayStats, dueSoon, estimateReport, habitWeek, projectSummary, recentlyAutoDropped, timeSpent } from "./stats";

// Noon local time on a given day, as ISO
const at = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, "0")}:00:00`).toISOString();

function setup(): Data {
  return applyAll(emptyData(), [
    { type: "addProject", at: at("2026-11-09"), project: { id: "p1", name: "RA Outreach", deadline: "2026-11-16", internalDeadline: "2026-11-13" } },
    { type: "addTask", at: at("2026-11-09"), task: { id: "a", title: "A", projectId: "p1", version: "submittable", scheduled: "2026-11-10", est: 60 } },
    { type: "addTask", at: at("2026-11-09"), task: { id: "b", title: "B", projectId: "p1", version: "submittable", scheduled: "2026-11-10", est: 30 } },
    { type: "addTask", at: at("2026-11-09"), task: { id: "c", title: "C", projectId: "p1", version: "good", scheduled: "2026-11-11" } },
  ]);
}

describe("durations", () => {
  it("parses and formats", () => {
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("2h30m")).toBe(150);
    expect(parseDuration("45 min")).toBe(45);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("soon")).toBeUndefined();
    expect(fmtMinutes(90)).toBe("1.5h");
    expect(fmtMinutes(45)).toBe("45m");
    expect(fmtMinutes(135)).toBe("2h15m");
  });
});

describe("daily record", () => {
  it("records planned and done for the day", () => {
    let d = setup();
    d = apply(d, { type: "tick", at: at("2026-11-10", 9) });
    expect(dayStats(d.days["2026-11-10"])).toMatchObject({ planned: 2, done: 0 });
    d = apply(d, { type: "setStatus", at: at("2026-11-10", 10), id: "a", status: "done", took: 90 });
    expect(dayStats(d.days["2026-11-10"])).toMatchObject({ planned: 2, done: 1, pct: 0.5 });
    expect(d.tasks.find((t) => t.id === "a")).toMatchObject({ doneOn: "2026-11-10", took: 90 });
  });

  it("moving a task later keeps it planned for the original day", () => {
    let d = apply(setup(), { type: "tick", at: at("2026-11-10", 9) });
    d = apply(d, { type: "updateTask", at: at("2026-11-10", 15), id: "b", patch: { scheduled: "2026-11-12" } });
    expect(d.days["2026-11-10"].planned).toEqual(["a", "b"]);
  });

  it("unchecking on the same day undoes done", () => {
    let d = apply(setup(), { type: "setStatus", at: at("2026-11-10"), id: "a", status: "done" });
    d = apply(d, { type: "setStatus", at: at("2026-11-10", 13), id: "a", status: "todo" });
    expect(d.days["2026-11-10"].done).toEqual([]);
  });

  it("a task added and scheduled during the day counts as planned", () => {
    let d = apply(setup(), { type: "tick", at: at("2026-11-10", 9) });
    d = apply(d, { type: "addTask", at: at("2026-11-10", 11), task: { id: "x", title: "X", projectId: "p1", scheduled: "2026-11-10" } });
    expect(dayStats(d.days["2026-11-10"])!.planned).toBe(3);
  });

  it("deleting a task the same day removes it from the plan", () => {
    let d = apply(setup(), { type: "tick", at: at("2026-11-10", 9) });
    d = apply(d, { type: "deleteTask", at: at("2026-11-10", 11), id: "b" });
    expect(d.days["2026-11-10"].planned).toEqual(["a"]);
  });

  it("settles late completions, backfills skipped days, records extras", () => {
    let d = apply(setup(), { type: "tick", at: at("2026-11-10", 9) });
    // Not opened 11/11 or 11/12. Next use on 11/13: B was completed on 11/10 (e.g. by the CLI with an old clock).
    d.tasks.find((t) => t.id === "b")!.status = "done";
    d.tasks.find((t) => t.id === "b")!.doneOn = "2026-11-10";
    d = apply(d, { type: "tick", at: at("2026-11-13") });
    expect(dayStats(d.days["2026-11-10"])!.done).toBe(1);
    expect(d.days["2026-11-11"]).toMatchObject({ src: "backfilled" });
    expect(d.days["2026-11-11"].planned).toEqual(["c"]);
    expect(d.days["2026-11-12"]).toBeUndefined();
    // Done today without being planned today
    d = apply(d, { type: "setStatus", at: at("2026-11-13", 14), id: "c", status: "done" });
    expect(d.days["2026-11-13"].extra).toEqual(["c"]);
  });

  it("dropped tasks stay planned and are counted separately", () => {
    let d = apply(setup(), { type: "setStatus", at: at("2026-11-10"), id: "b", status: "dropped" });
    expect(dayStats(d.days["2026-11-10"])).toMatchObject({ planned: 2, done: 0, dropped: 1 });
  });

  it("counts carried days", () => {
    let d = apply(setup(), { type: "tick", at: at("2026-11-10") });
    d = apply(d, { type: "updateTask", at: at("2026-11-10", 20), id: "b", patch: { scheduled: "2026-11-11" } });
    d = apply(d, { type: "tick", at: at("2026-11-11") });
    d = apply(d, { type: "tick", at: at("2026-11-12") });
    expect(carriedCount(d, "b", "2026-11-12")).toBe(2);
    expect(carriedOver(d, "2026-11-12").map((x) => [x.task.id, x.count])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 1],
    ]);
  });
});

describe("projects, habits, estimates", () => {
  it("ship mode and submittable progress", () => {
    const d = setup();
    const p = d.projects[0];
    expect(projectSummary(d, p, "2026-11-12").ship).toBe(false);
    expect(projectSummary(d, p, "2026-11-13").ship).toBe(true);
    expect(projectSummary(d, p, "2026-11-13").submittableOpen.length).toBe(2);
  });

  it("habit week counts from Monday", () => {
    let d = apply(emptyData(), { type: "addHabit", at: at("2026-11-09"), habit: { id: "h", name: "Meditation", target: 5 } });
    const days = ["2026-11-08", "2026-11-09", "2026-11-11"]; // Sun (last week), Mon, Wed
    for (const day of days) d = apply(d, { type: "toggleHabit", at: at(day), habitId: "h" });
    expect(habitWeek(d, "h", "2026-11-12")).toBe(2);
    d = apply(d, { type: "toggleHabit", at: at("2026-11-11", 18), habitId: "h" });
    expect(habitWeek(d, "h", "2026-11-12")).toBe(1);
  });

  it("estimate ratio", () => {
    let d = setup();
    const done: Action[] = [
      { type: "setStatus", at: at("2026-11-10"), id: "a", status: "done", took: 120 },
      { type: "setStatus", at: at("2026-11-10"), id: "b", status: "done", took: 30 },
    ];
    d = applyAll(d, done);
    d = apply(d, { type: "updateTask", at: at("2026-11-11"), id: "c", patch: { est: 60 } });
    d = apply(d, { type: "setStatus", at: at("2026-11-11"), id: "c", status: "done", took: 60 });
    const r = estimateReport(d, "2026-11-12");
    expect(r.n).toBe(3);
    expect(r.ratio).toBeCloseTo(210 / 150);
  });

  it("deleting a project moves its tasks to the inbox", () => {
    const d = apply(setup(), { type: "deleteProject", at: at("2026-11-10"), id: "p1" });
    expect(d.tasks.every((t) => t.projectId === null && t.version === "unsorted")).toBe(true);
  });
});

describe("dates", () => {
  it("weeks", () => {
    expect(weekStart("2026-11-05")).toBe("2026-11-02");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(isoWeek("2026-11-05")).toBe("2026-W45");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
  });
});

describe("idempotent adds", () => {
  it("re-applying an add with the same id does nothing", () => {
    const a: Action = { type: "addTask", at: at("2026-11-10"), task: { id: "dup", title: "Once" } };
    const d = applyAll(emptyData(), [a, a]);
    expect(d.tasks.filter((t) => t.id === "dup").length).toBe(1);
  });
});

describe("replay safety", () => {
  it("stamp assigns ids once, so replaying gives the same task", async () => {
    const { stamp } = await import("./actions");
    const a = stamp({ type: "addTask", task: { title: "Replayed" } });
    const first = apply(emptyData(), a);
    const second = apply(emptyData(), a);
    expect(first.tasks[0].id).toBe(second.tasks[0].id);
  });
});

describe("time spent and habit summary", () => {
  it("adds up actual time of tasks finished that day, even without estimates", async () => {
    const { timeSpent, habitSummary } = await import("./stats");
    let d = setup();
    d = apply(d, { type: "updateTask", at: at("2026-11-10"), id: "a", patch: { est: undefined } });
    d = apply(d, { type: "setStatus", at: at("2026-11-10", 14), id: "a", status: "done", took: 90 });
    d = apply(d, { type: "setStatus", at: at("2026-11-10", 15), id: "b", status: "done" });
    expect(timeSpent(d, "2026-11-10")).toEqual({ minutes: 90, missing: 1 });
    expect(timeSpent(d, "2026-11-11")).toEqual({ minutes: 0, missing: 0 });

    d = apply(d, { type: "addHabit", at: at("2026-11-10"), habit: { id: "h", name: "Exercise", target: 3 } });
    for (const day of ["2026-11-03", "2026-11-05", "2026-11-10"]) d = apply(d, { type: "toggleHabit", at: at("2026-11-10"), habitId: "h", day });
    expect(habitSummary(d, "h", "2026-11-10", 2)).toEqual({ days: 3, perWeek: 1.5 });
  });
});

describe("checking off on an earlier day", () => {
  // a and b are planned for 11-10, c for 11-11; the app is next opened on 11-12
  const opened = () => apply(apply(setup(), { type: "tick", at: at("2026-11-10", 9) }), { type: "tick", at: at("2026-11-12", 9) });

  it("counts toward that day's plan when it was planned then", () => {
    const d = apply(opened(), { type: "setStatus", at: at("2026-11-12", 10), id: "a", status: "done", took: 30, on: "2026-11-10" });
    expect(d.tasks.find((t) => t.id === "a")).toMatchObject({ doneOn: "2026-11-10", took: 30 });
    expect(dayStats(d.days["2026-11-10"])).toMatchObject({ planned: 2, done: 1 });
    expect(d.days["2026-11-12"]?.extra ?? []).not.toContain("a");
  });

  it("shows as also done when it wasn't planned that day", () => {
    const d = apply(opened(), { type: "setStatus", at: at("2026-11-12", 10), id: "c", status: "done", on: "2026-11-10" });
    expect(d.days["2026-11-10"].extra).toEqual(["c"]);
    expect(d.days["2026-11-11"].done).toEqual([]);
  });

  it("moves a completion from today to the earlier day", () => {
    let d = apply(opened(), { type: "setStatus", at: at("2026-11-12", 10), id: "c", status: "done" });
    expect(d.days["2026-11-12"].extra).toEqual(["c"]);
    d = apply(d, { type: "setStatus", at: at("2026-11-12", 11), id: "c", status: "done", on: "2026-11-11" });
    expect(d.days["2026-11-12"]?.extra ?? []).toEqual([]);
    expect(d.days["2026-11-11"].done).toEqual(["c"]);
  });

  it("un-checking with the day takes it off that day's record", () => {
    let d = apply(opened(), { type: "setStatus", at: at("2026-11-12", 10), id: "a", status: "done", on: "2026-11-10" });
    d = apply(d, { type: "setStatus", at: at("2026-11-12", 11), id: "a", status: "todo", on: "2026-11-10" });
    expect(d.days["2026-11-10"].done).toEqual([]);
    expect(d.days["2026-11-10"].planned).toEqual(["a", "b"]);
    // without the day, a past day keeps its completions as before
    d = apply(d, { type: "setStatus", at: at("2026-11-12", 12), id: "a", status: "done", on: "2026-11-10" });
    d = apply(d, { type: "setStatus", at: at("2026-11-12", 13), id: "a", status: "todo" });
    expect(d.days["2026-11-10"].done).toEqual(["a"]);
  });

  it("an un-check on a day with nothing else leaves no empty record", () => {
    let d = apply(opened(), { type: "setStatus", at: at("2026-11-12", 10), id: "c", status: "done", on: "2026-11-05" });
    expect(d.days["2026-11-05"].extra).toEqual(["c"]);
    d = apply(d, { type: "setStatus", at: at("2026-11-12", 11), id: "c", status: "todo", on: "2026-11-05" });
    expect(d.days["2026-11-05"]).toBeUndefined();
  });

  it("ignores today, later days, and days too far back", () => {
    for (const on of ["2026-11-12", "2026-11-14", "2026-08-01"]) {
      const d = apply(opened(), { type: "setStatus", at: at("2026-11-12", 10), id: "a", status: "done", on });
      expect(d.tasks.find((t) => t.id === "a")!.doneOn).toBe("2026-11-12");
      expect(d.days["2026-11-12"].extra).toEqual(["a"]); // recorded as done today, as usual
      expect(d.days["2026-11-10"].done).toEqual([]);
      if (on !== "2026-11-12") expect(d.days[on]).toBeUndefined();
    }
  });

  it("replays to the same result", () => {
    const a: Action = { type: "setStatus", at: at("2026-11-12", 10), id: "a", status: "done", on: "2026-11-10" };
    expect(apply(apply(opened(), a), a)).toEqual(apply(opened(), a));
  });

  it("never reaches days that may be archived", () => {
    expect(MAX_BACKDATE_DAYS).toBeLessThan(ARCHIVE_AFTER_DAYS);
  });
});

describe("due dates", () => {
  // d is due 11-12, e due 11-20, f due 11-10; none planned
  const withDue = () =>
    applyAll(setup(), [
      { type: "addTask", at: at("2026-11-09"), task: { id: "d", title: "D", due: "2026-11-12" } },
      { type: "addTask", at: at("2026-11-09"), task: { id: "e", title: "E", due: "2026-11-20" } },
      { type: "addTask", at: at("2026-11-09"), task: { id: "f", title: "F", due: "2026-11-10" } },
    ]);
  const task = (d: Data, id: string) => d.tasks.find((t) => t.id === id)!;

  it("due soon lists the next 3 days and passed due dates, soonest first", () => {
    const d = apply(withDue(), { type: "tick", at: at("2026-11-11") });
    expect(dueSoon(d, "2026-11-11").map((t) => t.id)).toEqual(["f", "d"]);
    const planned = apply(d, { type: "updateTask", at: at("2026-11-11"), id: "d", patch: { scheduled: "2026-11-11" } });
    expect(dueSoon(planned, "2026-11-11").map((t) => t.id)).toEqual(["f"]);
  });

  it("drops an open task 5 days after its due date", () => {
    let d = apply(withDue(), { type: "tick", at: at("2026-11-15") });
    expect(task(d, "f").status).toBe("todo"); // due 11-10: 11-11..11-15 are the 5 days
    d = apply(d, { type: "tick", at: at("2026-11-16") });
    expect(task(d, "f")).toMatchObject({ status: "dropped", droppedOn: "2026-11-16", autoDropped: true });
    expect(recentlyAutoDropped(d, "2026-11-16").map((t) => t.id)).toEqual(["f"]);
  });

  it("uses the drop day even when the app wasn't opened that day", () => {
    const d = apply(withDue(), { type: "tick", at: at("2026-11-19") });
    expect(task(d, "f").droppedOn).toBe("2026-11-16");
  });

  it("doesn't drop a task planned for today or later", () => {
    let d = apply(withDue(), { type: "updateTask", at: at("2026-11-09"), id: "f", patch: { scheduled: "2026-11-18" } });
    d = apply(d, { type: "tick", at: at("2026-11-17") });
    expect(task(d, "f").status).toBe("todo");
  });

  it("planning a past-due task moves its due date to that day and counts a reset", () => {
    let d = apply(withDue(), { type: "updateTask", at: at("2026-11-12"), id: "f", patch: { scheduled: "2026-11-13" } });
    expect(task(d, "f")).toMatchObject({ due: "2026-11-13", dueResets: 1 });
    // a new due date after it passed counts too; one set before it passed doesn't
    d = apply(d, { type: "updateTask", at: at("2026-11-14"), id: "f", patch: { due: "2026-11-17" } });
    expect(task(d, "f").dueResets).toBe(2);
    d = apply(d, { type: "updateTask", at: at("2026-11-14"), id: "e", patch: { due: "2026-11-21" } });
    expect(task(d, "e").dueResets).toBeUndefined();
  });

  it("reopening an auto-dropped task starts a new due date today", () => {
    let d = apply(withDue(), { type: "tick", at: at("2026-11-16") });
    d = apply(d, { type: "setStatus", at: at("2026-11-16", 13), id: "f", status: "todo" });
    expect(task(d, "f")).toMatchObject({ status: "todo", due: "2026-11-16", dueResets: 1 });
    expect(task(d, "f").autoDropped).toBeUndefined();
  });

  it("drops a task's open steps along with it (older data with steps outside projects)", () => {
    let d = withDue();
    d.tasks.push({ id: "f1", title: "F step", projectId: null, parentId: "f", version: "unsorted", status: "todo", order: 9, createdAt: "2026-11-09" });
    d = apply(d, { type: "tick", at: at("2026-11-16") });
    expect(task(d, "f1")).toMatchObject({ status: "dropped", autoDropped: true });
  });

  it("never drops project tasks automatically", () => {
    let d = apply(setup(), { type: "updateTask", at: at("2026-11-09"), id: "c", patch: { due: "2026-11-10", scheduled: undefined } });
    d = apply(d, { type: "tick", at: at("2026-11-25") });
    expect(task(d, "c").status).toBe("todo");
    expect(dueSoon(d, "2026-11-25").map((t) => t.id)).toContain("c"); // still listed, with its passed date
    // reopening a project task doesn't reset its due date either
    d = apply(d, { type: "setStatus", at: at("2026-11-25"), id: "c", status: "dropped" });
    d = apply(d, { type: "setStatus", at: at("2026-11-25", 13), id: "c", status: "todo" });
    expect(task(d, "c")).toMatchObject({ due: "2026-11-10" });
    expect(task(d, "c").dueResets).toBeUndefined();
  });
});

describe("steps", () => {
  const task = (d: Data, id: string) => d.tasks.find((t) => t.id === id)!;

  it("exist only in projects: a step under an inbox task becomes a plain task", () => {
    let d = apply(setup(), { type: "addTask", at: at("2026-11-09"), task: { id: "i", title: "Inbox task", projectId: null } });
    d = apply(d, { type: "addTask", at: at("2026-11-09"), task: { id: "i1", title: "Step", projectId: null, parentId: "i" } });
    expect(task(d, "i1").parentId).toBeUndefined();
    d = apply(d, { type: "addTask", at: at("2026-11-09"), task: { id: "a1", title: "Step", projectId: null, parentId: "a" } });
    expect(task(d, "a1")).toMatchObject({ parentId: "a", projectId: "p1" });
  });

  it("follow their parent to another project or the inbox", () => {
    let d = apply(setup(), { type: "addTask", at: at("2026-11-09"), task: { id: "a1", title: "Step", projectId: "p1", parentId: "a", version: "submittable" } });
    d = apply(d, { type: "addTask", at: at("2026-11-09"), task: { id: "a2", title: "Sub-step", projectId: "p1", parentId: "a1", version: "submittable" } });
    d = apply(d, { type: "updateTask", at: at("2026-11-09"), id: "a", patch: { projectId: null, version: "unsorted" } });
    expect(task(d, "a1")).toMatchObject({ projectId: null, version: "unsorted" });
    expect(task(d, "a2").projectId).toBeNull();
  });
});

describe("restarting a project's plan", () => {
  const task = (d: Data, id: string) => d.tasks.find((t) => t.id === id)!;
  // a (1h) and b (30m) planned 11-10, c (no estimate) 11-11; plus x (1h) planned 11-20
  const slipped = () =>
    applyAll(setup(), [
      { type: "addTask", at: at("2026-11-09"), task: { id: "x", title: "X", projectId: "p1", version: "good", scheduled: "2026-11-20", est: 60 } },
      { type: "tick", at: at("2026-11-14") },
    ]);

  it("moves slipped tasks forward in order, keeping later ones where they are", () => {
    const plan = restartPlan(slipped(), "p1", "2026-11-14");
    expect(plan.moves).toEqual([
      { id: "a", from: "2026-11-10", to: "2026-11-14" },
      { id: "b", from: "2026-11-10", to: "2026-11-14" },
      { id: "c", from: "2026-11-11", to: "2026-11-14" },
    ]);
    expect(plan.last).toBe("2026-11-20");
    expect(plan.unestimated).toBe(1);
    expect(plan.load).toEqual({ "2026-11-14": 120 });
  });

  it("fills each day up to the capacity guideline, counting other planned work", () => {
    let d = slipped();
    d = apply(d, { type: "addTask", at: at("2026-11-14"), task: { id: "o", title: "Other", projectId: null, scheduled: "2026-11-14", est: 240 } });
    const plan = restartPlan(d, "p1", "2026-11-14");
    // 4h already planned: a (1h) fits, b (30m) doesn't
    expect(plan.moves.map((m) => [m.id, m.to])).toEqual([
      ["a", "2026-11-14"],
      ["b", "2026-11-15"],
      ["c", "2026-11-15"],
    ]);
  });

  it("pushes a later task when the restarted plan reaches it", () => {
    let d = slipped();
    d = apply(d, { type: "updateTask", at: at("2026-11-14"), id: "x", patch: { scheduled: "2026-11-15", est: 120 } });
    d = apply(d, { type: "updateSettings", at: at("2026-11-14"), patch: { capacityHours: 1 } });
    const plan = restartPlan(d, "p1", "2026-11-14");
    // x fills the 15th, so b and c go to the 16th, and x moves after them
    expect(plan.moves.map((m) => [m.id, m.to])).toEqual([
      ["a", "2026-11-14"],
      ["b", "2026-11-16"],
      ["c", "2026-11-16"],
      ["x", "2026-11-17"],
    ]);
  });

  it("the replan action applies the moves like planning each task", () => {
    let d = slipped();
    const plan = restartPlan(d, "p1", "2026-11-15");
    d = apply(d, { type: "replan", at: at("2026-11-14", 13), projectId: "p1", moves: plan.moves.map((m) => ({ id: m.id, scheduled: m.to })) });
    expect(["a", "b", "c"].map((id) => task(d, id).scheduled)).toEqual(["2026-11-15", "2026-11-15", "2026-11-15"]);
    expect(carriedOver(d, "2026-11-14")).toEqual([]);
    expect(restartPlan(d, "p1", "2026-11-15").moves).toEqual([]);
  });
});

describe("deliverables", () => {
  const task = (d: Data, id: string) => d.tasks.find((t) => t.id === id)!;
  // "a" is planned for 11-10; make it a deliverable due 11-12
  const deliverable = () => apply(setup(), { type: "updateTask", at: at("2026-11-09"), id: "a", patch: { kind: "deliverable", due: "2026-11-12" } });

  it("Submittable counts as done for the day and stays open for polishing", () => {
    const d = apply(deliverable(), { type: "setLevel", at: at("2026-11-10"), id: "a", level: "submittable", took: 60 });
    expect(task(d, "a")).toMatchObject({ status: "todo", level: "submittable", submittableOn: "2026-11-10", took: 60 });
    expect(dayStats(d.days["2026-11-10"])).toMatchObject({ planned: 2, done: 1 });
    expect(isPolishing(task(d, "a"))).toBe(true);
    // the next day it isn't carried over: polishing is optional
    expect(carriedOver(apply(d, { type: "tick", at: at("2026-11-11") }), "2026-11-11").map((c) => c.task.id)).toEqual(["b"]);
  });

  it("Good finishes it; time adds up and is split across the two days", () => {
    let d = apply(deliverable(), { type: "setLevel", at: at("2026-11-10"), id: "a", level: "submittable", took: 60 });
    d = apply(d, { type: "setLevel", at: at("2026-11-11"), id: "a", level: "good", took: 30 });
    expect(task(d, "a")).toMatchObject({ status: "done", level: "good", doneOn: "2026-11-11", took: 90 });
    expect(timeSpent(d, "2026-11-10").minutes).toBe(60);
    expect(timeSpent(d, "2026-11-11").minutes).toBe(30);
    expect(d.days["2026-11-11"].extra).toEqual(["a"]); // finished on a day it wasn't planned
  });

  it("finishes at Submittable once the due date has passed, without new record entries", () => {
    let d = apply(deliverable(), { type: "setLevel", at: at("2026-11-10"), id: "a", level: "submittable", took: 60 });
    d = apply(d, { type: "tick", at: at("2026-11-12") });
    expect(task(d, "a").status).toBe("todo"); // polishing allowed through the due date
    d = apply(d, { type: "tick", at: at("2026-11-13") });
    expect(task(d, "a")).toMatchObject({ status: "done", level: "submittable", doneOn: "2026-11-10" });
    expect(d.days["2026-11-13"]?.extra ?? []).toEqual([]);
    expect(timeSpent(d, "2026-11-10").minutes).toBe(60);
  });

  it("finish as is adds the polishing time", () => {
    let d = apply(deliverable(), { type: "setLevel", at: at("2026-11-10"), id: "a", level: "submittable", took: 60 });
    d = apply(d, { type: "setStatus", at: at("2026-11-11"), id: "a", status: "done", took: 15 });
    expect(task(d, "a")).toMatchObject({ status: "done", level: "submittable", took: 75 });
  });

  it("undoing Submittable takes it off the day", () => {
    let d = apply(deliverable(), { type: "setLevel", at: at("2026-11-10"), id: "a", level: "submittable", took: 60 });
    d = apply(d, { type: "setLevel", at: at("2026-11-10", 13), id: "a", level: null });
    expect(task(d, "a").level).toBeUndefined();
    expect(task(d, "a").took).toBeUndefined();
    expect(d.days["2026-11-10"].done).toEqual([]);
  });

  it("reopening a Good deliverable goes back to polishing", () => {
    let d = apply(deliverable(), { type: "setLevel", at: at("2026-11-10"), id: "a", level: "submittable", took: 60 });
    d = apply(d, { type: "setLevel", at: at("2026-11-11"), id: "a", level: "good", took: 30 });
    d = apply(d, { type: "setStatus", at: at("2026-11-11", 13), id: "a", status: "todo" });
    expect(task(d, "a")).toMatchObject({ status: "todo", level: "submittable", took: 60 });
  });

  it("a deliverable past its due date isn't auto-dropped while it has a Submittable", () => {
    let d = apply(deliverable(), { type: "setLevel", at: at("2026-11-10"), id: "a", level: "submittable" });
    d = apply(d, { type: "tick", at: at("2026-11-20") });
    expect(task(d, "a")).toMatchObject({ status: "done", level: "submittable" });
    expect(task(d, "a").autoDropped).toBeUndefined();
  });

  it("switching back to a check task clears the level", () => {
    let d = apply(deliverable(), { type: "setLevel", at: at("2026-11-10"), id: "a", level: "submittable" });
    d = apply(d, { type: "updateTask", at: at("2026-11-10"), id: "a", patch: { kind: "" as never } });
    expect(task(d, "a").level).toBeUndefined();
    expect(task(d, "a").submittableOn).toBeUndefined();
  });
});
