/**
 * TaskLube CLI (tl): how an agent (or you) reads and changes TaskLube data from a terminal.
 * It applies changes through the same rules as the app, so the daily record stays consistent.
 *
 *   npm run tl -- show today|week|projects|project <name>|inbox|record [days]|habits|tasks <text>|tags
 *   npm run tl -- apply '<action JSON or array>' [-m "message"] [--no-git] [--as-me]
 *   npm run tl -- migrate      (one-time: logger.json -> tasklube.json; also happens on first apply)
 *   (new tasks/projects are tagged by: "claude" unless --as-me)
 *
 * Data file: --data <path>, or $TL_DATA, default ~/Co-Projects/tl-data/tasklube.json.
 * Archive files (archive/<year>.json) next to it are read for history views and written when
 * old history gets moved out (same rules as the app, see src/core/format.ts).
 * With git: pulls first, then commits ("claude: …" by default) and pushes. If the push is
 * rejected because the app saved meanwhile, it pulls and re-applies the actions.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { applyAll, describe, stamp, type Action, type ActionInput } from "../src/core/actions";
import { addDays, fmtDay, relDay, today, weekDays } from "../src/core/dates";
import {
  isMovedStub,
  legacyStub,
  mergeArchive,
  parseArchive,
  parseData,
  paths,
  serializeArchive,
  serializeData,
  splitArchive,
  withHistory,
} from "../src/core/format";
import { emptyData, fmtMinutes, isOpen, VERSIONS, type Archive, type Data, type Task } from "../src/core/model";
import { carriedOver, dayStats, estimateReport, habitWeek, plannedEstimate, projectSummary, tagReport, timeSpent } from "../src/core/stats";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
function bool(name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

const dataPath = resolve((flag("--data") ?? process.env.TL_DATA ?? process.env.LOGGER_DATA ?? `${homedir()}/Co-Projects/tl-data/tasklube.json`).replace(/^~/, homedir()));
const message = flag("-m");
const noGit = bool("--no-git");
const asMe = bool("--as-me"); // don't tag new tasks/projects as created by Claude
const dir = dirname(dataPath);
const files = paths(dataPath);
const useGit = !noGit && existsSync(resolve(dir, ".git"));

function git(...a: string[]) {
  return execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function hasRemote() {
  try {
    return git("remote").length > 0;
  } catch {
    return false;
  }
}
/** Pull if the remote branch exists (a brand-new repo has nothing to pull). */
function pull() {
  const branch = git("symbolic-ref", "--short", "HEAD");
  if (git("ls-remote", "--heads", "origin", branch)) git("pull", "--rebase", "--quiet", "origin", branch);
}

/** The legacy file still holds the real data (not migrated yet). */
function legacyPending(): boolean {
  return !existsSync(files.hot) && files.legacy !== files.hot && existsSync(files.legacy) && !isMovedStub(readFileSync(files.legacy, "utf8"));
}
function load(): Data {
  if (existsSync(files.hot)) return parseData(readFileSync(files.hot, "utf8"));
  if (legacyPending()) return parseData(readFileSync(files.legacy, "utf8"));
  return emptyData();
}
function loadArchives(): Archive[] {
  if (!existsSync(files.archiveDir)) return [];
  return readdirSync(files.archiveDir)
    .filter((n) => /^\d{4}\.json$/.test(n))
    .sort()
    .map((n) => parseArchive(readFileSync(files.archiveFile(n.slice(0, 4)), "utf8"), n.slice(0, 4)));
}
/** Write the main file (moving old history to the archive first), and finish a pending migration. */
function save(d: Data): string[] {
  const touched = [files.hot];
  if (legacyPending()) {
    writeFileSync(files.legacy, legacyStub());
    touched.push(files.legacy);
  }
  const split = splitArchive(d, day);
  if (split) {
    mkdirSync(files.archiveDir, { recursive: true });
    for (const [year, add] of Object.entries(split.byYear)) {
      const f = files.archiveFile(year);
      const existing = existsSync(f) ? parseArchive(readFileSync(f, "utf8"), year) : null;
      writeFileSync(f, serializeArchive(mergeArchive(existing, add)));
      touched.push(f);
    }
    d = split.hot;
  }
  writeFileSync(files.hot, serializeData(d));
  return touched;
}

const [cmd, ...rest] = args;
const day = today();

function pname(d: Data, id: string | null | undefined) {
  if (!id) return "Inbox";
  return d.projects.find((p) => p.id === id)?.name ?? id;
}
function line(t: Task, d: Data, opts: { project?: boolean } = {}) {
  const box = t.status === "done" ? "[x]" : t.status === "dropped" ? "[-]" : t.status === "doing" ? "[/]" : "[ ]";
  const bits = [
    opts.project ? pname(d, t.projectId) : "",
    t.version !== "unsorted" && t.projectId ? t.version : "",
    t.est != null ? `est ${fmtMinutes(t.est)}` : "",
    t.took != null ? `took ${fmtMinutes(t.took)}` : "",
    t.scheduled ? `planned ${t.scheduled}` : "",
    t.due ? `due ${t.due}` : "",
    t.dread ? `dread ${t.dread}` : "",
    t.tags?.length ? t.tags.map((x) => "#" + x).join(" ") : "",
  ].filter(Boolean);
  return `${box} ${t.title}${bits.length ? "  (" + bits.join(", ") + ")" : ""}  {${t.id}}`;
}

function show(d: Data, what: string, arg: string) {
  const out: string[] = [];
  switch (what) {
    case "today": {
      const rec = d.days[day];
      const st = dayStats(rec);
      const est = plannedEstimate(rec, d);
      const spent = timeSpent(d, day);
      out.push(`Today ${day}: ${st ? `${st.done} of ${st.planned} planned done (${Math.round(st.pct * 100)}%)` : "nothing planned"}; spent ${fmtMinutes(spent.minutes) || "0m"}${spent.missing ? ` (+${spent.missing} finished without a time)` : ""}; estimated ${fmtMinutes(est.minutes) || "0m"} (guideline ${d.settings.capacityHours}h)`);
      for (const t of d.tasks.filter((x) => x.scheduled === day)) out.push("  " + line(t, d, { project: true }));
      const ship = d.projects.map((p) => projectSummary(d, p, day)).filter((s) => s.ship);
      for (const s of ship) out.push(`Ship mode: ${s.project.name} (deadline ${s.project.deadline}), Submittable open: ${s.submittableOpen.length}`);
      const carried = carriedOver(d, day);
      if (carried.length) out.push("Carried over:", ...carried.map((c) => `  ${line(c.task, d, { project: true })} carried ${c.count}x`));
      const habits = d.habits.filter((h) => !h.archived);
      if (habits.length) out.push("Habits this week: " + habits.map((h) => `${h.name} ${habitWeek(d, h.id, day)}/${h.target}${d.habitLog[day]?.includes(h.id) ? " (done today)" : ""}`).join(", "));
      break;
    }
    case "week": {
      const start = arg || day;
      for (const dd of weekDays(start)) {
        const tasks = d.tasks.filter((t) => t.scheduled === dd);
        const est = tasks.reduce((a, t) => a + (t.est ?? 0), 0);
        const spent = dd <= day ? timeSpent(d, dd).minutes : 0;
        out.push(`${dd} ${fmtDay(dd, { weekday: "short" })}: ${fmtMinutes(est) || "0m"} estimated${spent ? `, ${fmtMinutes(spent)} spent` : ""}`);
        for (const t of tasks) out.push("  " + line(t, d, { project: true }));
      }
      break;
    }
    case "projects":
      for (const p of d.projects) {
        const s = projectSummary(d, p, day);
        out.push(
          `${p.name} {${p.id}} [${p.status}]${p.deadline ? ` deadline ${p.deadline} (${relDay(p.deadline, day)})` : ""}${p.internalDeadline ? `, internal ${p.internalDeadline}` : ""}${s.ship ? " SHIP MODE" : ""}; ${s.open} open, ${s.done} done${s.submittable.length ? `, Submittable ${s.submittable.length - s.submittableOpen.length}/${s.submittable.length}` : ""}`
        );
      }
      break;
    case "project": {
      const p = d.projects.find((x) => x.id === arg || x.name.toLowerCase().includes(arg.toLowerCase()));
      if (!p) throw new Error(`No project matching "${arg}"`);
      out.push(`${p.name} {${p.id}} [${p.status}] deadline ${p.deadline ?? "-"}, internal ${p.internalDeadline ?? "-"}`);
      if (p.goal) out.push(`Goal: ${p.goal}`);
      if (p.links) out.push(`Links: ${p.links}`);
      const tasks = d.tasks.filter((t) => t.projectId === p.id);
      const print = (t: Task, depth: number) => {
        out.push("  ".repeat(depth + 1) + line(t, d));
        for (const c of tasks.filter((x) => x.parentId === t.id).sort((a, b) => a.order - b.order)) print(c, depth + 1);
      };
      for (const v of VERSIONS) {
        const top = tasks.filter((t) => t.version === v.id && !t.parentId).sort((a, b) => a.order - b.order);
        if (!top.length) continue;
        out.push(`## ${v.label}`);
        top.forEach((t) => print(t, 0));
      }
      if (p.wrapup) out.push(`Wrap-up: ${JSON.stringify(p.wrapup)}`);
      break;
    }
    case "inbox":
      for (const t of d.tasks.filter((x) => x.projectId === null && isOpen(x))) out.push(line(t, d));
      if (!out.length) out.push("Inbox is empty.");
      break;
    case "tasks": {
      const q = arg.toLowerCase();
      for (const t of d.tasks.filter((x) => x.title.toLowerCase().includes(q))) out.push(line(t, d, { project: true }));
      break;
    }
    case "habits":
      for (const h of d.habits) out.push(`${h.name} {${h.id}} target ${h.target}/week${h.archived ? " (archived)" : ""}, this week ${habitWeek(d, h.id, day)}`);
      break;
    case "record": {
      const n = parseInt(arg || "14", 10);
      for (let i = n; i >= 0; i--) {
        const dd = addDays(day, -i);
        const rec = d.days[dd];
        const st = dayStats(rec);
        const habits = (d.habitLog[dd] ?? []).map((id) => d.habits.find((h) => h.id === id)?.name ?? id);
        if (!st && !habits.length && !rec?.extra.length) continue;
        out.push(
          `${dd}: ${st ? `${st.done}/${st.planned} planned done (${Math.round(st.pct * 100)}%)${st.dropped ? `, ${st.dropped} dropped` : ""}` : "nothing planned"}${rec?.src === "backfilled" ? " [reconstructed]" : ""}${rec?.extra.length ? `, also done: ${rec.extra.length}` : ""}${habits.length ? `; habits: ${habits.join(", ")}` : ""}`
        );
      }
      const e = estimateReport(d, day);
      out.push(e.n ? `Estimates (30 days): ${e.n} tasks, actual/estimate ${e.ratio!.toFixed(2)}x; ${e.bySize.map((s) => `${s.label} ${s.ratio.toFixed(2)}x (${s.n})`).join(", ")}` : "Estimates: no tasks with both est and took yet.");
      break;
    }
    case "tags":
      for (const r of tagReport(d, day)) out.push(`#${r.tag}: planned ${r.planned}, done that day ${r.done}, finished ${r.finished}${r.ratio != null ? `, actual/estimate ${r.ratio.toFixed(2)}x` : ""} (last 30 days)`);
      if (!out.length) out.push("No tagged tasks in the last 30 days.");
      break;
    default:
      throw new Error(`Unknown view "${what}". Try: today, week, projects, project <name>, inbox, tasks <text>, habits, record [days], tags`);
  }
  console.log(out.join("\n"));
}

function applyCmd(json: string, msgOverride?: string) {
  const parsed = JSON.parse(json);
  const inputs: ActionInput[] = Array.isArray(parsed) ? parsed : [parsed];
  const actions: Action[] = inputs.map((a) => {
    if (!asMe && a.type === "addTask") a = { ...a, task: { by: "claude", ...a.task } };
    if (!asMe && a.type === "addProject") a = { ...a, project: { by: "claude", ...a.project } };
    return stamp(a);
  });

  let touched: string[] = [];
  const run = () => {
    const before = load();
    const after = applyAll(before, actions);
    touched = save(after);
    return { before, after };
  };

  if (!useGit) {
    run();
    console.log(`Applied ${actions.length} action(s) to ${dataPath} (no git).`);
    return;
  }
  const remote = hasRemote();
  if (remote) pull();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { before } = run();
    const custom = msgOverride ?? message;
    const msg = custom ? (custom.startsWith("claude:") ? custom : `claude: ${custom}`) : `claude: ${describe(actions[0], before)}${actions.length > 1 ? ` (+${actions.length - 1} more)` : ""}`;
    git("add", "--", ...touched);
    try {
      git("commit", "--quiet", "-m", msg, "-m", "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>");
    } catch {
      console.log("No changes to save.");
      return;
    }
    if (!remote) break;
    try {
      // Test hook: simulate another device saving between our pull and push
      if (attempt === 0 && process.env.TL_TEST_BEFORE_PUSH) execFileSync("sh", ["-c", process.env.TL_TEST_BEFORE_PUSH], { stdio: "ignore" });
      git("push", "--quiet", "-u", "origin", "HEAD");
      break;
    } catch {
      // The app saved meanwhile: drop our commit, take theirs, re-apply
      git("reset", "--hard", "--quiet", "HEAD~1");
      pull();
      if (attempt === 2) throw new Error("Couldn't push after 3 tries.");
    }
  }
  console.log(`Applied ${actions.length} action(s)${remote ? " and pushed" : ""}.`);
}

try {
  if (cmd === "show") {
    if (useGit && hasRemote()) pull();
    const view = rest[0] ?? "today";
    // History views include archived tasks and days
    const d = ["record", "project", "tasks", "tags"].includes(view) ? withHistory(load(), loadArchives()) : load();
    show(d, view, rest.slice(1).join(" "));
  } else if (cmd === "migrate") {
    if (!legacyPending()) {
      console.log(existsSync(files.hot) ? "Already migrated." : "Nothing to migrate.");
    } else {
      applyCmd('{"type":"tick"}', "claude: move data to tasklube.json (compact format)");
    }
  } else if (cmd === "apply") {
    if (!rest[0]) throw new Error("apply needs an action JSON");
    applyCmd(rest[0]);
  } else {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 12).join("\n"));
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
