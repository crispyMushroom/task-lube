# TaskLube (TL)

Agent-friendly task and progress tracker: a neutral record of what you planned and what you did. Tasks, projects with deadlines, habits, and a daily "planned vs. done" record shown as a heatmap.

- **No backend.** TaskLube is a static site. Your data is one JSON document in a **private GitHub repo** that you own. The app reads and writes it with a fine-grained token stored only in your browser.
- **Works on a phone.** Add it to your home screen (PWA). It opens offline and saves when you're back online.
- **Built to be operated by an LLM agent too.** The same core logic ships as a CLI (`npm run tl`), so an agent can plan your week, break down tasks or write a weekly review by changing the same data. Every change is a git commit.

## Ideas it's built around

- **Daily %:** of the tasks planned for a day, how many were done that day. Moving a task later doesn't rewrite the day it was planned for. Days with nothing planned stay blank.
- **Estimates vs. actual:** checking a task off asks how long it took, so estimate accuracy shows up over time.
- **Three versions per project:** Submittable, Good, Stretch. Between the internal deadline and the real deadline, the project is in **ship mode**, and only what's left for Submittable is shown.
- **Habits are about consistency:** a weekly target, no streaks.

## Setup

1. Create a private repo for your data (e.g. `tl-data`).
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) while signed in as the account that owns that repo:
   - Repository access: **only that repo**
   - Permissions: **Contents: Read and write**
3. Open the app and enter the repo and token. The data file (`tasklube.json`) is created on first use. History older than 90 days moves to `archive/<year>.json` automatically, so the main file stays small.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # core logic + app smoke test
npm run build      # type-check and build into dist/
npm run tl -- show today --data path/to/logger.json
```

Pushing to `main` runs the tests and deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions).

See [AGENTS.md](AGENTS.md) for architecture, the rules the code relies on, and how to change it safely.
