import { useState } from "react";
import { addDays, fmtDay } from "../core/dates";
import type { ActionInput } from "../core/actions";
import { DUE_GRACE_DAYS, fmtMinutes, isPastDue, isPolishing, parseDuration, VERSIONS, type Level, type Task, type TaskStatus, type Version } from "../core/model";
import { allTags } from "../core/stats";
import { Dialog, EstPicker, TaskRow } from "./common";
import { useTaskLube } from "./context";

const LEVELS: [Level | null, string][] = [
  [null, "Not yet"],
  ["submittable", "Submittable"],
  ["good", "Good"],
];

const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "done", label: "Done" },
  { id: "dropped", label: "Dropped" },
];

export function TaskSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, dispatch, day } = useTaskLube();
  const task = id ? data.tasks.find((t) => t.id === id) : undefined;
  return (
    <Dialog open={!!task} onClose={onClose} title="Task" wide>
      {task && <TaskForm key={task.id} task={task} onClose={onClose} dispatch={dispatch} day={day} />}
    </Dialog>
  );
}

function TaskForm({ task, onClose, dispatch, day }: { task: Task; onClose: () => void; dispatch: ReturnType<typeof useTaskLube>["dispatch"]; day: string }) {
  const { data } = useTaskLube();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [took, setTook] = useState(task.took != null ? fmtMinutes(task.took) : "");
  const [sub, setSub] = useState("");
  const patch = (p: Partial<Task>) => dispatch({ type: "updateTask", id: task.id, patch: p });
  const subtasks = data.tasks.filter((t) => t.parentId === task.id);
  const parent = task.parentId ? data.tasks.find((t) => t.id === task.parentId) : undefined;

  return (
    <div className="form">
      <input
        className="title-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== task.title && patch({ title: title.trim() })}
      />
      {parent && <p className="hint">Step of: {parent.title}</p>}

      <div className="grid2">
        <label className="field">
          <span className="label">Project</span>
          <select
            value={task.projectId ?? ""}
            onChange={(e) => patch({ projectId: e.target.value || null, ...(e.target.value ? {} : { version: "unsorted" as Version }) })}
          >
            <option value="">Inbox</option>
            {data.projects
              .filter((p) => p.status === "active" || p.id === task.projectId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Version</span>
          <select value={task.version} onChange={(e) => patch({ version: e.target.value as Version })} disabled={!task.projectId}>
            {VERSIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field">
        <span className="label">Status</span>
        <div className="chips-row">
          {STATUSES.map((s) => (
            <button key={s.id} className={task.status === s.id ? "pill is-on" : "pill"} onClick={() => dispatch({ type: "setStatus", id: task.id, status: s.id })}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">Planned for</span>
        <div className="chips-row">
          <button className={task.scheduled === day ? "pill is-on" : "pill"} onClick={() => patch({ scheduled: day })}>
            Today
          </button>
          <button className={task.scheduled === addDays(day, 1) ? "pill is-on" : "pill"} onClick={() => patch({ scheduled: addDays(day, 1) })}>
            Tomorrow
          </button>
          <input type="date" value={task.scheduled ?? ""} onChange={(e) => patch({ scheduled: e.target.value || undefined })} />
          {task.scheduled && (
            <button className="pill" onClick={() => patch({ scheduled: undefined })}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="field">
        <span className="label">Due</span>
        <div className="chips-row">
          {[
            ["Today", day],
            ["Tomorrow", addDays(day, 1)],
            ["In a week", addDays(day, 7)],
          ].map(([label, d]) => (
            <button key={label} className={task.due === d ? "pill is-on" : "pill"} onClick={() => patch({ due: d })}>
              {label}
            </button>
          ))}
          <input type="date" value={task.due ?? ""} onChange={(e) => patch({ due: e.target.value || undefined })} />
          {task.due && (
            <button className="pill" onClick={() => patch({ due: undefined })}>
              Clear
            </button>
          )}
        </div>
        {(task.dueResets || isPastDue(task, day)) && (
          <span className="hint">
            {isPastDue(task, day) && !(task.scheduled && task.scheduled >= day) ? `Drops automatically after ${fmtDay(addDays(task.due!, DUE_GRACE_DAYS))} unless planned or moved. ` : ""}
            {task.dueResets ? `Due date reset ${task.dueResets}× after it passed.` : ""}
          </span>
        )}
      </div>

      <div className="grid2">
        <div className="field">
          <span className="label">Kind</span>
          <div className="chips-row">
            <button className={task.kind !== "deliverable" ? "pill is-on" : "pill"} onClick={() => patch({ kind: undefined })}>
              Check
            </button>
            <button className={task.kind === "deliverable" ? "pill is-on" : "pill"} onClick={() => patch({ kind: "deliverable" })}>
              Deliverable
            </button>
          </div>
        </div>
        {task.kind === "deliverable" && (
          <div className="field">
            <span className="label">Level</span>
            <div className="chips-row">
              {LEVELS.map(([id, label]) => (
                <button
                  key={label}
                  className={(task.level ?? null) === id ? "pill is-on" : "pill"}
                  onClick={() => (task.level ?? null) !== id && dispatch({ type: "setLevel", id: task.id, level: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {task.kind === "deliverable" && (
        <p className="hint">Submittable counts as done for the day. It stays open for optional polishing until Good, or until the due date.</p>
      )}

      <div className="grid2">
        <div className="field">
          <span className="label">Dread (optional)</span>
          <div className="chips-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={task.dread === n ? "pill is-on" : "pill"} onClick={() => patch({ dread: task.dread === n ? undefined : n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <TagEditor tags={task.tags ?? []} known={allTags(data)} onChange={(tags) => patch({ tags: tags.length ? tags : undefined })} />

      <EstPicker value={task.est} onChange={(v) => patch({ est: v })} />

      <label className="field">
        <span className="label">Took</span>
        <input
          placeholder="e.g. 45m, 1.5h"
          value={took}
          onChange={(e) => setTook(e.target.value)}
          onBlur={() => {
            const m = parseDuration(took);
            if (took.trim() === "") patch({ took: undefined });
            else if (m) patch({ took: m });
          }}
        />
      </label>

      <label className="field">
        <span className="label">Notes</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (task.notes ?? "") && patch({ notes })} />
      </label>

      <div className="field">
        <span className="label">Steps</span>
        {subtasks.map((t) => (
          <TaskRow key={t.id} task={t} showDate />
        ))}
        <form
          className="quick-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sub.trim()) return;
            dispatch({ type: "addTask", task: { title: sub.trim(), projectId: task.projectId, version: task.version, parentId: task.id } });
            setSub("");
          }}
        >
          <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Add a step" />
          <button className="btn" type="submit" disabled={!sub.trim()}>
            Add
          </button>
        </form>
      </div>

      <div className="form-foot">
        <button
          className="btn danger"
          onClick={() => {
            if (confirm(`Delete "${task.title}"${subtasks.length ? " and its steps" : ""}? Dropping it keeps it in the record instead.`)) {
              dispatch({ type: "deleteTask", id: task.id });
              onClose();
            }
          }}
        >
          Delete
        </button>
        <button className="btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** A step that asks how long it took, then applies `make(took)`. */
export interface TookRequest {
  task: Task;
  on?: string;
  make: (took?: number) => ActionInput;
  /** Shown above the time choices, e.g. "Submittable version". */
  step?: string;
}

/** Choose a deliverable's step: Submittable, Good, finish as is, or undo Submittable. */
export function LevelDialog({ req, onClose, askTook }: { req: { task: Task; on?: string } | null; onClose: () => void; askTook: (r: TookRequest) => void }) {
  const { dispatch } = useTaskLube();
  const task = req?.task;
  const on = req?.on;
  const polishing = !!task && isPolishing(task);
  const withOn = on ? { on } : {};
  const next = (step: string, make: TookRequest["make"]) => {
    onClose();
    askTook({ task: task!, on, make, step });
  };
  return (
    <Dialog open={!!task} onClose={onClose} title={polishing ? "Submittable reached" : "Which version is done?"}>
      {task && (
        <div className="form">
          <p>{task.title}</p>
          {on && <p className="hint">Counts as done on {fmtDay(on, { weekday: "long", month: "short", day: "numeric" })}</p>}
          <div className="level-choices">
            {!polishing && (
              <button className="btn primary" onClick={() => next("Submittable version", (took) => ({ type: "setLevel", id: task.id, level: "submittable", ...(took ? { took } : {}), ...withOn }))}>
                Submittable version
              </button>
            )}
            <button className={polishing ? "btn primary" : "btn"} onClick={() => next("Good version", (took) => ({ type: "setLevel", id: task.id, level: "good", ...(took ? { took } : {}), ...withOn }))}>
              Good, finished
            </button>
            {polishing && (
              <button className="btn" onClick={() => next("Polishing", (took) => ({ type: "setStatus", id: task.id, status: "done", ...(took ? { took } : {}), ...withOn }))}>
                Finish as is
              </button>
            )}
            {polishing && (
              <button
                className="btn"
                onClick={() => {
                  dispatch({ type: "setLevel", id: task.id, level: null, ...(on && task.submittableOn ? { on: task.submittableOn } : {}) });
                  onClose();
                }}
              >
                Not submittable yet
              </button>
            )}
          </div>
          <p className="hint">
            {polishing
              ? `Polishing is optional${task.due ? ` and ends ${fmtDay(task.due)}` : ""}.`
              : "Submittable counts as done for the day. Polishing after that is optional."}
          </p>
        </div>
      )}
    </Dialog>
  );
}

export function TookDialog({ req, onClose }: { req: TookRequest | null; onClose: () => void }) {
  const { dispatch } = useTaskLube();
  const [other, setOther] = useState("");
  const task = req?.task;
  const on = req?.on;
  const finish = (took?: number) => {
    if (req) dispatch(req.make(took));
    setOther("");
    onClose();
  };
  return (
    <Dialog open={!!task} onClose={onClose} title="Took about how long?">
      {task && (
        <div className="form">
          <p>
            {task.title}
            {req?.step ? <span className="muted"> · {req.step}</span> : null}
          </p>
          {task.est != null && <p className="hint">Estimated {fmtMinutes(task.est)}</p>}
          {on && <p className="hint">Counts as done on {fmtDay(on, { weekday: "long", month: "short", day: "numeric" })}</p>}
          <div className="chips-row">
            {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
              <button key={m} className="pill big" onClick={() => finish(m)}>
                {fmtMinutes(m)}
              </button>
            ))}
          </div>
          <form
            className="quick-add"
            onSubmit={(e) => {
              e.preventDefault();
              const m = parseDuration(other);
              if (m) finish(m);
            }}
          >
            <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Other (e.g. 5h, 20m)" />
            <button className="btn" type="submit" disabled={!parseDuration(other)}>
              Save
            </button>
          </form>
          <div className="form-foot">
            <button className="btn" onClick={() => finish()}>
              Skip, just mark done
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Tags: tap one to remove it, type to add, or pick one you've used before. */
function TagEditor({ tags, known, onChange }: { tags: string[]; known: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const next = raw
      .split(",")
      .map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-"))
      .filter(Boolean);
    if (next.length) onChange([...new Set([...tags, ...next])]);
    setText("");
  };
  const suggestions = known.filter((t) => !tags.includes(t)).slice(0, 8);
  return (
    <div className="field">
      <span className="label">Tags</span>
      <div className="chips-row">
        {tags.map((t) => (
          <button key={t} className="pill is-on" title="Remove" onClick={() => onChange(tags.filter((x) => x !== t))}>
            #{t} ×
          </button>
        ))}
        <input
          className="pill-input"
          style={{ width: 120 }}
          placeholder="add tag"
          value={text}
          onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
            }
          }}
          onBlur={() => text.trim() && add(text)}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="chips-row">
          {suggestions.map((t) => (
            <button key={t} className="pill" onClick={() => onChange([...tags, t])}>
              #{t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
