import { useState } from "react";
import { fmtDay, relDay } from "../core/dates";
import { VERSIONS, type Project, type ProjectStatus, type Task } from "../core/model";
import { projectSummary } from "../core/stats";
import { Empty, QuickAdd, Section, TaskRow } from "./common";
import { go, useTaskLube } from "./context";

const STATUSES: ProjectStatus[] = ["active", "paused", "submitted", "done", "dropped"];

export function ProjectList() {
  const { data, dispatch, day } = useTaskLube();
  const [showAll, setShowAll] = useState(false);
  const list = data.projects
    .filter((p) => showAll || p.status === "active" || p.status === "paused")
    .sort((a, b) => (a.deadline ?? "9999") < (b.deadline ?? "9999") ? -1 : 1);
  return (
    <div className="page">
      <QuickAdd
        placeholder="New project name…"
        onAdd={(name) => {
          const id = "p_" + Date.now().toString(36);
          dispatch({ type: "addProject", project: { id, name } });
          go(`projects/${id}`);
        }}
      />
      {list.length === 0 && <Empty>No projects yet.</Empty>}
      {list.map((p) => {
        const s = projectSummary(data, p, day);
        return (
          <a key={p.id} className="card project-card" href={`#/projects/${p.id}`}>
            <div className="project-card-head">
              <strong>{p.name}</strong>
              {s.ship && <span className="badge">Ship mode</span>}
              {p.status !== "active" && <span className="chip">{p.status}</span>}
            </div>
            <div className="muted small">
              {p.deadline ? `Deadline ${fmtDay(p.deadline)} (${relDay(p.deadline, day)}) · ` : ""}
              {s.submittable.length ? `Submittable ${s.submittable.length - s.submittableOpen.length}/${s.submittable.length} · ` : ""}
              {s.open} open · {s.done} done
            </div>
          </a>
        );
      })}
      <button className="btn link" onClick={() => setShowAll(!showAll)}>
        {showAll ? "Hide finished projects" : "Show finished and dropped projects"}
      </button>
    </div>
  );
}

function Tree({ tasks, all, depth = 0 }: { tasks: Task[]; all: Task[]; depth?: number }) {
  return (
    <>
      {tasks
        .sort((a, b) => a.order - b.order)
        .map((t) => (
          <div key={t.id}>
            <TaskRow task={t} showDate depth={depth} />
            <Tree tasks={all.filter((c) => c.parentId === t.id)} all={all} depth={depth + 1} />
          </div>
        ))}
    </>
  );
}

export function ProjectPage({ id }: { id: string }) {
  const { data, dispatch, day } = useTaskLube();
  const p = data.projects.find((x) => x.id === id);
  if (!p) return <div className="page"><Empty>This project doesn't exist anymore.</Empty></div>;
  return <ProjectForm key={p.id} p={p} data={data} dispatch={dispatch} day={day} />;
}

function ProjectForm({ p, data, dispatch, day }: { p: Project; data: ReturnType<typeof useTaskLube>["data"]; dispatch: ReturnType<typeof useTaskLube>["dispatch"]; day: string }) {
  const [name, setName] = useState(p.name);
  const [goal, setGoal] = useState(p.goal ?? "");
  const [links, setLinks] = useState(p.links ?? "");
  const [wrap, setWrap] = useState(p.wrapup ?? {});
  const [showDropped, setShowDropped] = useState(false);
  const patch = (x: Partial<Project>) => dispatch({ type: "updateProject", id: p.id, patch: x });
  const s = projectSummary(data, p, day);
  const tasks = data.tasks.filter((t) => t.projectId === p.id && (showDropped || t.status !== "dropped"));
  const top = (version: string) => tasks.filter((t) => t.version === version && (!t.parentId || !tasks.some((x) => x.id === t.parentId)));

  return (
    <div className="page">
      <a className="back" href="#/projects">
        ← Projects
      </a>
      <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== p.name && patch({ name: name.trim() })} />
      {s.ship && (
        <div className="card ship-card">
          <span className="badge">Ship mode</span> Until {fmtDay(p.deadline!)}: finish Submittable, then submit. New ideas go to v2.
        </div>
      )}

      <div className="grid3">
        <label className="field">
          <span className="label">Status</span>
          <select value={p.status} onChange={(e) => patch({ status: e.target.value as ProjectStatus })}>
            {STATUSES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Internal deadline (Submittable)</span>
          <input type="date" value={p.internalDeadline ?? ""} onChange={(e) => patch({ internalDeadline: e.target.value || undefined })} />
        </label>
        <label className="field">
          <span className="label">Deadline</span>
          <input type="date" value={p.deadline ?? ""} onChange={(e) => patch({ deadline: e.target.value || undefined })} />
        </label>
      </div>

      <label className="field">
        <span className="label">Goal</span>
        <input value={goal} onChange={(e) => setGoal(e.target.value)} onBlur={() => goal !== (p.goal ?? "") && patch({ goal })} placeholder="One line: what done looks like" />
      </label>
      <label className="field">
        <span className="label">Links and notes</span>
        <textarea rows={2} value={links} onChange={(e) => setLinks(e.target.value)} onBlur={() => links !== (p.links ?? "") && patch({ links })} />
      </label>
      {p.links && (
        <div className="links">
          {p.links.match(/https?:\/\/\S+/g)?.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer">
              {u.replace(/^https?:\/\//, "").slice(0, 50)}
            </a>
          ))}
        </div>
      )}

      {VERSIONS.map((v) => {
        const list = top(v.id);
        if (v.id === "unsorted" && list.length === 0) return null;
        const done = tasks.filter((t) => t.version === v.id && t.status === "done").length;
        const total = tasks.filter((t) => t.version === v.id && t.status !== "dropped").length;
        return (
          <Section key={v.id} title={v.label} right={total ? <span className="muted small">{done}/{total} done</span> : undefined}>
            {v.hint && <p className="muted small">{v.hint}</p>}
            {list.length ? <Tree tasks={list} all={tasks} /> : <Empty>No tasks.</Empty>}
            <QuickAdd placeholder={`Add to ${v.label}…`} onAdd={(title) => dispatch({ type: "addTask", task: { title, projectId: p.id, version: v.id } })} />
          </Section>
        );
      })}
      <button className="btn link" onClick={() => setShowDropped(!showDropped)}>
        {showDropped ? "Hide dropped tasks" : "Show dropped tasks"}
      </button>

      <Section title="Wrap-up">
        <p className="muted small">After the deadline: three neutral lines.</p>
        {(["planned", "happened", "grew"] as const).map((k) => (
          <label key={k} className="field">
            <span className="label">{k[0].toUpperCase() + k.slice(1)}</span>
            <input
              value={wrap[k] ?? ""}
              onChange={(e) => setWrap({ ...wrap, [k]: e.target.value })}
              onBlur={() => (wrap[k] ?? "") !== (p.wrapup?.[k] ?? "") && patch({ wrapup: { ...p.wrapup, [k]: wrap[k] } })}
            />
          </label>
        ))}
      </Section>

      <button
        className="btn danger"
        onClick={() => {
          if (confirm(`Delete "${p.name}"? Its tasks move to the inbox. Setting the status to dropped keeps it in the record instead.`)) {
            dispatch({ type: "deleteProject", id: p.id });
            go("projects");
          }
        }}
      >
        Delete project
      </button>
    </div>
  );
}
