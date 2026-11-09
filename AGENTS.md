# AGENTS.md: maintaining TaskLube

This is the guide for any coding agent (or person) changing this repo. It covers what the app is, how the pieces fit, the rules the code relies on, and how to ship a change. **This repo is public:** never commit personal data, names, emails, tokens or anything from a user's data repo.

## What it is

TaskLube (TL) is a static React PWA for tasks, projects, habits and a daily planned-vs-done record. There is no server.

```
 Browser app (PWA) ──GitHub contents API──►  private data repo: tasklube.json + archive/<year>.json
                                                  ▲
 CLI (scripts/tl.ts) ──git pull/commit/push───────┘   (used by an LLM agent on a local clone)
```

- **Data files** (all handled in `src/core/format.ts`):
  - `tasklube.json`: the main file (`Data` in `src/core/model.ts`), sent in full on every save.
  - `archive/<year>.json` (`Archive`): finished tasks, day records and habit days older than 90 days. Loaded only for history views.
  - `logger.json`: the legacy v1 file. After migration it's a small pointer stub, so outdated cached apps can't overwrite the real data.
- **Writers:** the app, through the GitHub contents API with the user's fine-grained token, and the CLI, through git on a local clone. Both apply changes through the **same core code**.

## Layout

| Path | What |
|---|---|
| `src/core/model.ts` | Types: `Data`, `Task`, `Project`, `Habit`, `DayRecord`. Duration helpers. |
| `src/core/actions.ts` | **The only way data changes.** `Action` union, `stamp()`, `apply()`, `describe()`. |
| `src/core/days.ts` | `recordDay()`: keeps the daily record (planned/done/dropped/extra, backfill, per-project counts). |
| `src/core/stats.ts` | Read-only derived numbers: day %, carried-over counts, habit weeks, estimate ratio, growth. |
| `src/core/dates.ts` | Local-calendar `YYYY-MM-DD` helpers, ISO weeks. |
| `src/core/format.ts` | File names, compact serialization (one item per line, defaults omitted), migrations, `NewerFormatError`, archive split/merge, `withHistory()`. |
| `src/sync/github.ts` | Read and write one file through the GitHub contents API. Error messages for token problems. |
| `src/sync/store.ts` | App state: `view = base + pending`, debounced saves, conflict replay, offline cache in localStorage, one-time legacy migration, daily archiving, lazy archive loading (`history()`). |
| `src/ui/` | Screens (Today, Week, Projects, Inbox, Stats ("Record" tab), Settings/Setup) and shared pieces. |
| `scripts/tl.ts` | CLI: `show <view>` and `apply <actions>`, with git pull, commit and push, plus retry on conflict. |
| `public/` | Manifest, service worker (network-first app-shell cache), icons. |
| `.github/workflows/deploy.yml` | On push to `main`: `npm ci`, test, build, deploy to Pages. |

## Rules the code relies on (don't break these)

1. **Every change goes through `apply(data, action)`.** It deep-copies, applies, then calls `recordDay()` for the action's day. UI code and the CLI never mutate `Data` directly. To add a new kind of change, add an `Action` variant, handle it in `apply`, and add a `describe` case.
2. **Actions must replay deterministically.** The store re-applies pending actions on top of a newer remote version after a conflict. So:
   - `stamp()` assigns `at` and the ids of new items, once.
   - `apply()` must not read the clock or randomness. Use `action.at`.
   - Adds are idempotent by id.
3. **Daily record semantics** (`days.ts`). Day records hold **task ids only**; titles come from the task, or from `deleted` (tombstones) for tasks deleted later. The UI and the user's understanding of their history depend on these:
   - **Planned only grows** during a day: any task whose `scheduled` equals that day is added. Moving a task later doesn't remove it. Deleting a task the same day does.
   - **Today stays live:** done and dropped can be undone. Past days only gain completions (settled once, when the next day starts).
   - **Late check-offs:** `setStatus` with `on: <earlier day>` (up to `MAX_BACKDATE_DAYS` = 60 back) sets `doneOn` to that day and re-records the task there (`resettlePastDay`). It counts as done if it was planned that day, otherwise as `extra`. With a status other than done, `on` takes the task off that day's record. This is the one way a past day loses a completion, and the UI only sends it when un-checking from that past day's view (Week → tap a day, with "Check off as done on …" switched on).
   - **Skipped days** (up to 14) are backfilled from tasks still scheduled on them and marked `src: "backfilled"`.
   - **Done** = planned tasks with `status: "done"` and `doneOn` equal to that day. Tasks done without being planned go in `extra`, not in the %.
4. **Format changes go through `format.ts`.**
   - The current format is `SCHEMA_VERSION` (2). `parseData()` migrates older files and throws `NewerFormatError` for newer ones. The store then blocks saving and asks for a reload, so an old app can't overwrite newer data.
   - New fields are optional, and defaults are filled in by `normTask` / `normDay` and stripped again by `compactTask` / `compactDay`.
   - To rename or remove a field, bump `SCHEMA_VERSION`, add a migration in `parseData()` and `parseArchive()`, and add a test with a sample file in the old format (see `format.test.ts`).
   - Old cached app versions may still run for a while. If a change would let one of them corrupt the new shape, move to a new file name, as v2 did with `tasklube.json`.
5. **Archive rules** (`splitArchive`): move only tasks that are done/dropped for over 90 days with no unfinished steps, day records over 90 days old, and old habit days. Write archive files first and the main file second. Merging is idempotent, and `withHistory()` lets the main file win, so an interrupted archive never loses or duplicates anything. History views (Record screen, day details, weekly reviews) must use `history()` / `withHistory()`, not the main file alone.
6. **Legacy names stay as they are.** The localStorage keys (`logger.config`, `logger.cache`) predate the rename to TaskLube, and a configured `path` of `logger.json` is mapped to `tasklube.json` next to it by `paths()`. Changing the keys disconnects every configured device.
7. **Wording is neutral.** UI copy says "carried over", "not done", "moved", "dropped", "nothing planned". Never "overdue", "failed", "missed", "streak", or red warning styles for not-done work. The point of the app is a record without guilt.
8. **Durations are minutes** (`est`, `took`). Dates (including `createdAt`) are local `YYYY-MM-DD` strings, which compare correctly as strings. Tags are lowercase strings without `#`.
9. **The token stays in the browser.** Don't log it, send it anywhere but `api.github.com`, or add analytics or third-party scripts.

## Making a change

```bash
npm install
npm test            # vitest: core rules + jsdom smoke test of the whole app (local mode)
npm run typecheck
npm run build
```

- **Core changes need tests** in `src/core/core.test.ts`. User-facing flows are covered by `src/ui/smoke.test.tsx`, so extend it when adding a screen or flow.
- **Ship by pushing to `main`.** The workflow tests, builds and deploys, so check the Actions run succeeded. The service worker is network-first, so users get the new version on next load.
- **Commits:** imperative summary line. Agents add a `Co-Authored-By` trailer for themselves.

## CLI

```bash
npm run -s tl -- show today|week [date]|projects|project <name>|inbox|tasks <text>|habits|record [days]|tags [--data <path>]
npm run -s tl -- migrate
npm run -s tl -- apply '<action JSON or array>' -m "summary" [--data <path>] [--no-git] [--as-me]
```

- **Data path:** `--data`, else `$TL_DATA`, else `~/Co-Projects/tl-data/tasklube.json`. Archives are read from `archive/` next to it for `record`, `project`, `tasks` and `tags`.
- **`migrate`:** converts a legacy `logger.json` once. Any `apply` also does it.
- **With git:** it pulls first, commits (`claude: …` prefix by default), and pushes. If the push is rejected, it drops its commit, pulls, and re-applies (up to 3 tries).
- **Tagging:** new tasks and projects get `by: "claude"` unless `--as-me` is passed. The app shows these as "by Claude".
- **Action shapes:** see the `Action` type in `src/core/actions.ts`. To clear a field, set it to `""` in a patch.
- **Testing the conflict path:** set `TL_TEST_BEFORE_PUSH` to a shell command that commits elsewhere.
