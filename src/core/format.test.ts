import { describe, expect, it } from "vitest";
import { apply, applyAll } from "./actions";
import { mergeArchive, NewerFormatError, parseData, serializeArchive, serializeData, splitArchive, withHistory, legacyStub, isMovedStub, parseArchive } from "./format";
import { emptyData, SCHEMA_VERSION, taskInfo, type Data } from "./model";
import { dayStats, projectGrowth, tagReport } from "./stats";

const at = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, "0")}:00:00`).toISOString();

// A file in the old (v1) format, like logger.json before this change
const V1 = JSON.stringify({
  version: 1,
  settings: { capacityHours: 5 },
  projects: [{ id: "p1", name: "RA", status: "active", createdAt: "2026-11-05T22:30:00.000Z" }],
  tasks: [
    { id: "a", projectId: "p1", version: "submittable", title: "A", status: "done", order: 0, createdAt: "2026-11-05T22:30:00.000Z", doneOn: "2026-11-06", took: 60 },
    { id: "b", projectId: "p1", version: "unsorted", title: "B", status: "todo", order: 1, createdAt: "2026-11-05T22:30:00.000Z" },
  ],
  habits: [{ id: "h1", name: "Meditation", target: 5 }],
  habitLog: { "2026-11-06": ["h1"] },
  days: {
    "2026-11-06": {
      planned: { a: { title: "A", projectId: "p1", est: 60 }, gone: { title: "Deleted later", projectId: "p1" } },
      done: ["a"],
      dropped: [],
      extra: {},
      src: "live",
      counts: { p1: [2, 1] },
    },
  },
  lastDay: "2026-11-06",
});

describe("migration from v1", () => {
  it("converts day records to ids, keeps titles of deleted tasks, drops counts", () => {
    const d = parseData(V1);
    expect(d.version).toBe(SCHEMA_VERSION);
    expect(d.days["2026-11-06"]).toEqual({ planned: ["a", "gone"], done: ["a"], dropped: [], extra: [] });
    expect(d.deleted.gone).toEqual({ title: "Deleted later", projectId: "p1" });
    expect(taskInfo(d, "gone").title).toBe("Deleted later");
    expect(d.tasks[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dayStats(d.days["2026-11-06"])).toMatchObject({ planned: 2, done: 1 });
  });

  it("the legacy stub is a valid old-format file that points to the new one", () => {
    expect(isMovedStub(legacyStub())).toBe(true);
    expect(isMovedStub(V1)).toBe(false);
    expect(JSON.parse(legacyStub()).version).toBe(1);
  });
});

describe("compact format", () => {
  it("round-trips, leaves out defaults, one item per line, and is valid JSON", () => {
    const d = parseData(V1);
    const text = serializeData(d);
    expect(parseData(text)).toEqual(d);
    expect(text).not.toContain('"status":"todo"');
    expect(text).not.toContain('"version":"unsorted"');
    expect(text).toContain('"status":"done"');
    const taskLines = text.split("\n").filter((l) => l.startsWith('{"id":"a"') || l.startsWith('{"id":"b"'));
    expect(taskLines.length).toBe(2);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("refuses data from a newer format", () => {
    expect(() => parseData(JSON.stringify({ version: SCHEMA_VERSION + 1 }))).toThrow(NewerFormatError);
  });

  it("is much smaller than the old format for the same data", () => {
    let d: Data = emptyData();
    d = apply(d, { type: "addProject", at: at("2026-01-01"), project: { id: "p", name: "P" } });
    for (let i = 0; i < 60; i++) {
      const day = new Date(2026, 0, 1 + i);
      const ds = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      for (let k = 0; k < 5; k++) d = apply(d, { type: "addTask", at: at(ds, 9), task: { id: `t${i}_${k}`, title: `Write section ${k} of the report draft`, projectId: "p", est: 60, scheduled: ds } });
      for (let k = 0; k < 3; k++) d = apply(d, { type: "setStatus", at: at(ds, 15), id: `t${i}_${k}`, status: "done", took: 75 });
    }
    const compact = serializeData(d).length;
    const old = JSON.stringify(d, null, 1).length;
    expect(compact / old).toBeLessThan(0.75);
  });
});

describe("archive", () => {
  function sample(): Data {
    // Actions in time order, as they'd really happen
    return applyAll(emptyData(), [
      { type: "addProject", at: at("2026-01-02"), project: { id: "p", name: "P" } },
      { type: "addTask", at: at("2026-01-02"), task: { id: "old", title: "Old done", projectId: "p", scheduled: "2026-01-05" } },
      { type: "addTask", at: at("2026-01-02"), task: { id: "parent", title: "Parent done", projectId: "p" } },
      { type: "addTask", at: at("2026-01-02"), task: { id: "child", title: "Child open", projectId: "p", parentId: "parent" } },
      { type: "addTask", at: at("2026-01-02"), task: { id: "gone", title: "Deleted", projectId: "p", scheduled: "2026-01-04" } },
      { type: "toggleHabit", at: at("2026-01-04"), habitId: "h" },
      { type: "setStatus", at: at("2026-01-05"), id: "old", status: "done" },
      { type: "setStatus", at: at("2026-01-05"), id: "parent", status: "done" },
      { type: "deleteTask", at: at("2026-01-06"), id: "gone" },
      { type: "addTask", at: at("2026-05-01"), task: { id: "recent", title: "Recent", projectId: "p", scheduled: "2026-05-01" } },
      { type: "setStatus", at: at("2026-05-01"), id: "recent", status: "done" },
    ]);
  }

  it("moves finished tasks and days older than 90 days, keeps the rest", () => {
    const d = sample();
    expect(d.deleted.gone).toBeDefined();
    const split = splitArchive(d, "2026-05-10")!;
    expect(split).not.toBeNull();
    const a = split.byYear["2026"];
    expect(a.tasks.map((t) => t.id)).toEqual(["old"]);
    expect(Object.keys(a.days).sort()).toEqual(["2026-01-04", "2026-01-05"]);
    expect(a.habitLog["2026-01-04"]).toEqual(["h"]);
    expect(a.deleted.gone).toBeDefined();
    // Parent stays with its open step; recent stuff stays
    expect(split.hot.tasks.map((t) => t.id).sort()).toEqual(["child", "parent", "recent"]);
    expect(Object.keys(split.hot.days)).toEqual(["2026-05-01"]);
    expect(split.hot.deleted.gone).toBeUndefined();
    expect(splitArchive(split.hot, "2026-05-10")).toBeNull();
  });

  it("history views see everything again, and merging is safe to repeat", () => {
    const d = sample();
    const split = splitArchive(d, "2026-05-10")!;
    const a = split.byYear["2026"];
    const twice = mergeArchive(mergeArchive(null, a), a);
    expect(twice.tasks.length).toBe(1);
    const reread = parseArchive(serializeArchive(twice), "2026");
    const full = withHistory(split.hot, [reread]);
    expect(full.tasks.length).toBe(d.tasks.length);
    expect(dayStats(full.days["2026-01-05"])!.done).toBe(1);
    expect(taskInfo(full, "gone").title).toBe("Deleted");
  });
});

describe("tags and growth", () => {
  it("reports per tag and grows from task dates", () => {
    let d = applyAll(emptyData(), [
      { type: "addProject", at: at("2026-11-01"), project: { id: "p", name: "P" } },
      { type: "addTask", at: at("2026-11-01"), task: { id: "w", title: "Write", projectId: "p", tags: ["writing"], est: 60, scheduled: "2026-11-02" } },
      { type: "setStatus", at: at("2026-11-02"), id: "w", status: "done", took: 90 },
      { type: "addTask", at: at("2026-11-03"), task: { id: "r", title: "Read", projectId: "p", tags: ["research", "writing"], est: 30, scheduled: "2026-11-03" } },
    ]);
    d = apply(d, { type: "tick", at: at("2026-11-04") });
    const w = tagReport(d, "2026-11-04").find((r) => r.tag === "writing")!;
    expect(w).toMatchObject({ planned: 2, done: 1, finished: 1 });
    expect(w.ratio).toBeCloseTo(1.5);
    const g = projectGrowth(d, "p", "2026-11-04");
    expect(g.map((x) => [x.day, x.total, x.done])).toEqual([
      ["2026-11-01", 1, 0],
      ["2026-11-02", 1, 1],
      ["2026-11-03", 2, 1],
      ["2026-11-04", 2, 1],
    ]);
  });
});
