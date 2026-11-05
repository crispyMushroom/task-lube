# Logger

A neutral record of what you planned and what you did. Tasks, projects with deadlines, habits, and a daily "planned vs. done" record shown as a heatmap.

- **No backend.** The app is a static site. Your data is one JSON file in a **private GitHub repo** that you own; the app reads and writes it with a fine-grained token stored only in your browser.
- **Works on a phone.** Add it to your home screen (PWA). It opens offline and saves when you're back online.
- **Built to be read by an AI assistant.** The same core logic is available as a CLI (`npm run logger`), so an agent can plan your week or break down tasks by editing the same data, with every change committed to git.

## Ideas it's built around

- **Daily %:** of the tasks planned for a day, how many were done that day. Moving a task later doesn't rewrite the day it was planned for. Days with nothing planned stay blank.
- **Estimates vs. actual:** checking a task off asks how long it took, so estimate accuracy becomes visible over time.
- **Three versions per project:** Submittable, Good, Stretch. Between the internal deadline and the real deadline, the project is in **ship mode**: only what's left for Submittable is shown.
- **Habits are about consistency:** a weekly target, no streaks.

## Setup

1. Create a private repo for your data (e.g. `logger-data`).
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to **only that repo** and **Contents: Read and write**.
3. Open the app, enter the repo and token. The data file is created on first use.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # core logic tests
npm run build      # production build into dist/
npm run logger -- show today --data path/to/logger.json
```

Pushing to `main` deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions).

## Layout

| Path | What |
|---|---|
| `src/core/` | Data model, actions, daily record, stats. Shared by the app and the CLI. |
| `src/sync/` | GitHub contents API and the store (pending changes, conflict replay, offline cache). |
| `src/ui/` | React screens: Today, Week, Projects, Inbox, Record, Settings. |
| `scripts/logger.ts` | CLI for reading and changing data from a terminal. |
