import { useState } from "react";
import { isOpen } from "../core/model";
import { Empty, Section, TaskRow } from "./common";
import { useLogger } from "./context";

export function Inbox() {
  const { data, dispatch } = useLogger();
  const [dump, setDump] = useState("");
  const items = data.tasks.filter((t) => t.projectId === null && !t.parentId && isOpen(t)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const projects = data.projects.filter((p) => p.status === "active");

  return (
    <div className="page">
      <Section title="Brain dump">
        <p className="muted small">One item per line. Messy is fine. Claude can sort these into projects (/sort-inbox).</p>
        <textarea rows={4} value={dump} onChange={(e) => setDump(e.target.value)} placeholder={"email prof about…\nfix plots in genetok\n…"} />
        <button
          className="btn primary"
          disabled={!dump.trim()}
          onClick={() => {
            for (const line of dump.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean)) {
              dispatch({ type: "addTask", task: { title: line, projectId: null } });
            }
            setDump("");
          }}
        >
          Add to inbox
        </button>
      </Section>

      <Section title={`Inbox (${items.length})`}>
        {items.length === 0 && <Empty>Inbox is empty.</Empty>}
        {items.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            showDate
            actions={
              <select
                className="mini-select"
                value=""
                onChange={(e) => e.target.value && dispatch({ type: "updateTask", id: t.id, patch: { projectId: e.target.value, version: "unsorted" } })}
              >
                <option value="">Move to…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            }
          />
        ))}
      </Section>
    </div>
  );
}
