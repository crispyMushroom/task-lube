import { useMemo, useState } from "react";
import type { Task } from "./core/model";
import { loadConfig, Store, type Config } from "./sync/store";
import { StoreContext, UiContext, useHash, useTaskLube, type UiApi } from "./ui/context";
import { Inbox } from "./ui/Inbox";
import { ProjectList, ProjectPage } from "./ui/Projects";
import { Settings, Setup } from "./ui/Settings";
import { DayDialog, Stats } from "./ui/Stats";
import { TaskSheet, TookDialog } from "./ui/TaskSheet";
import { Today } from "./ui/Today";
import { Week } from "./ui/Week";

const TABS = [
  { id: "today", label: "Today", icon: "◉" },
  { id: "week", label: "Week", icon: "▦" },
  { id: "projects", label: "Projects", icon: "◫" },
  { id: "inbox", label: "Inbox", icon: "⇣" },
  { id: "stats", label: "Record", icon: "▤" },
];

export function App() {
  const [config, setConfig] = useState<Config | null>(loadConfig);
  if (!config) return <Setup onDone={setConfig} />;
  return <Connected config={config} />;
}

function Connected({ config }: { config: Config }) {
  const store = useMemo(() => new Store(config), [config]);
  return (
    <StoreContext.Provider value={store}>
      <Shell config={config} />
    </StoreContext.Provider>
  );
}

function Shell({ config }: { config: Config }) {
  const { data, status, dispatch, store } = useTaskLube();
  const [route, ...rest] = useHash();
  const tab = route || "today";
  const [taskId, setTaskId] = useState<string | null>(null);
  const [tookFor, setTookFor] = useState<Task | null>(null);
  const [day, setDay] = useState<string | null>(null);

  const ui: UiApi = {
    openTask: setTaskId,
    openDay: setDay,
    complete: (t) => {
      if (t.status === "done") dispatch({ type: "setStatus", id: t.id, status: "todo" });
      else setTookFor(t);
    },
  };

  const inboxCount = data.tasks.filter((t) => t.projectId === null && !t.parentId && (t.status === "todo" || t.status === "doing")).length;

  let page;
  if (!store.loaded) page = <div className="page muted">Loading…</div>;
  else if (tab === "week") page = <Week />;
  else if (tab === "projects" && rest[0]) page = <ProjectPage id={rest[0]} />;
  else if (tab === "projects") page = <ProjectList />;
  else if (tab === "inbox") page = <Inbox />;
  else if (tab === "stats") page = <Stats />;
  else if (tab === "settings") page = <Settings config={config} />;
  else page = <Today />;

  const statusText =
    status.kind === "saved" ? "Saved" : status.kind === "saving" ? "Saving…" : status.kind === "pending" ? "Saving…" : status.kind === "loading" ? "Loading…" : status.kind === "offline" ? "Offline" : "Not saved";

  return (
    <UiContext.Provider value={ui}>
      <header className="top">
        <a className="brand" href="#/today">
          TaskLube
        </a>
        <nav className="tabs">
          {TABS.map((t) => (
            <a key={t.id} href={`#/${t.id}`} className={tab === t.id ? "tab is-on" : "tab"}>
              <span className="tab-icon">{t.icon}</span>
              <span className="tab-label">
                {t.label}
                {t.id === "inbox" && inboxCount > 0 ? ` (${inboxCount})` : ""}
              </span>
            </a>
          ))}
        </nav>
        <span className={`sync sync-${status.kind}`} title={"message" in status ? status.message : statusText} onClick={() => store.refresh()}>
          {statusText}
        </span>
        <a className={tab === "settings" ? "tab is-on gear" : "tab gear"} href="#/settings" aria-label="Settings">
          ⚙
        </a>
      </header>
      {"message" in status && <div className={`banner banner-${status.kind}`}>{status.message}</div>}
      <main>{page}</main>
      <TaskSheet id={taskId} onClose={() => setTaskId(null)} />
      <TookDialog task={tookFor} onClose={() => setTookFor(null)} />
      <DayDialog day={day} onClose={() => setDay(null)} />
    </UiContext.Provider>
  );
}
