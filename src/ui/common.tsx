import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmtDay, relDay } from "../core/dates";
import { fmtMinutes, parseDuration, type Data, type Task } from "../core/model";
import { useTaskLube, useUi } from "./context";

export const EST_CHOICES = [15, 30, 60, 120];

export function projectName(data: Data, id: string | null | undefined): string {
  if (!id) return "Inbox";
  return data.projects.find((p) => p.id === id)?.name ?? "(deleted project)";
}

export function Check({ task }: { task: Task }) {
  const { complete } = useUi();
  const cls = task.status === "done" ? "check is-done" : task.status === "dropped" ? "check is-dropped" : task.status === "doing" ? "check is-doing" : "check";
  return (
    <button
      className={cls}
      aria-label={task.status === "done" ? "Mark not done" : "Mark done"}
      onClick={(e) => {
        e.stopPropagation();
        complete(task);
      }}
    >
      {task.status === "done" ? "✓" : task.status === "dropped" ? "–" : ""}
    </button>
  );
}

export function TaskRow({
  task,
  showProject,
  showDate,
  extra,
  actions,
  depth = 0,
}: {
  task: Task;
  showProject?: boolean;
  showDate?: boolean;
  extra?: ReactNode;
  actions?: ReactNode;
  depth?: number;
}) {
  const { data, day } = useTaskLube();
  const { openTask } = useUi();
  const chips: string[] = [];
  if (showProject) chips.push(projectName(data, task.projectId));
  if (task.est != null) chips.push(task.took != null ? `${fmtMinutes(task.est)} → ${fmtMinutes(task.took)}` : fmtMinutes(task.est));
  else if (task.took != null) chips.push(`took ${fmtMinutes(task.took)}`);
  if (showDate && task.scheduled) chips.push(task.scheduled === day ? "today" : fmtDay(task.scheduled));
  if (task.due) chips.push(`due ${relDay(task.due, day)}`);
  if (task.dread) chips.push(`dread ${task.dread}`);
  for (const tag of task.tags ?? []) chips.push(`#${tag}`);
  if (task.by === "claude") chips.push("by Claude");
  return (
    <div className={`task-row status-${task.status}`} style={depth ? { paddingLeft: depth * 20 } : undefined}>
      <Check task={task} />
      <button className="task-title" onClick={() => openTask(task.id)}>
        {task.title}
      </button>
      <span className="task-meta">
        {chips.map((c, i) => (
          <span key={i} className="chip">
            {c}
          </span>
        ))}
        {extra}
      </span>
      {actions && <span className="task-actions">{actions}</span>}
    </div>
  );
}

/** Modal built on <dialog>. Closes on Escape or backdrop click. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog-body">
          <div className="dialog-head">
            <h2>{title}</h2>
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function EstPicker({ value, onChange, label = "Estimate" }: { value?: number; onChange: (v: number | undefined) => void; label?: string }) {
  const [text, setText] = useState(value != null && !EST_CHOICES.includes(value) ? fmtMinutes(value) : "");
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="chips-row">
        {EST_CHOICES.map((m) => (
          <button key={m} className={value === m ? "pill is-on" : "pill"} onClick={() => onChange(value === m ? undefined : m)}>
            {fmtMinutes(m)}
          </button>
        ))}
        <input
          className="pill-input"
          placeholder="other"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const m = parseDuration(text);
            if (m) onChange(m);
          }}
        />
      </div>
      {value != null && value > 120 && <span className="hint">Over 2h: consider breaking this into smaller tasks.</span>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onAdd(v.trim());
        setV("");
      }}
    >
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
      <button type="submit" className="btn" disabled={!v.trim()}>
        Add
      </button>
    </form>
  );
}

export function Bar({ pct }: { pct: number }) {
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
  );
}
