import { useState } from "react";
import { addDays, fmtDay, weekDays, weekStart } from "../core/dates";
import { fmtMinutes, isOpen, type Task } from "../core/model";
import { dayStats } from "../core/stats";
import { Empty, Section, TaskRow, projectName } from "./common";
import { useTaskLube } from "./context";

export function Week() {
  const { data, dispatch, day } = useTaskLube();
  const [offset, setOffset] = useState(0);
  const start = addDays(weekStart(day), offset * 7);
  const days = weekDays(start);
  const cap = data.settings.capacityHours * 60;

  const unscheduled = data.tasks.filter((t) => isOpen(t) && !t.scheduled && !data.tasks.some((s) => s.parentId === t.id && isOpen(s)));
  const groups = new Map<string, Task[]>();
  for (const t of unscheduled) {
    const key = t.projectId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const projectOrder = [...groups.keys()].sort((a, b) => {
    const pa = data.projects.find((p) => p.id === a);
    const pb = data.projects.find((p) => p.id === b);
    return (pa?.deadline ?? "9999") < (pb?.deadline ?? "9999") ? -1 : 1;
  });

  return (
    <div className="page">
      <div className="week-nav">
        <button className="btn" onClick={() => setOffset(offset - 1)}>
          ← Prev
        </button>
        <strong>
          {fmtDay(days[0])} – {fmtDay(days[6])}
        </strong>
        <button className="btn" onClick={() => setOffset(offset + 1)}>
          Next →
        </button>
        {offset !== 0 && (
          <button className="btn" onClick={() => setOffset(0)}>
            This week
          </button>
        )}
      </div>

      <div className="week-grid">
        {days.map((d) => {
          const tasks = data.tasks.filter((t) => t.scheduled === d);
          const est = tasks.filter((t) => t.status !== "dropped").reduce((a, t) => a + (t.est ?? 0), 0);
          const st = d < day ? dayStats(data.days[d]) : null;
          return (
            <div key={d} className={d === day ? "week-day is-today" : "week-day"}>
              <div className="week-day-head">
                <span>{fmtDay(d, { weekday: "short", day: "numeric" })}</span>
                <span className={est > cap ? "muted over" : "muted"}>
                  {fmtMinutes(est) || "0m"} / {data.settings.capacityHours}h{st ? ` · ${st.done}/${st.planned} done` : ""}
                </span>
              </div>
              {tasks.length ? tasks.map((t) => <TaskRow key={t.id} task={t} showProject />) : <Empty>—</Empty>}
            </div>
          );
        })}
      </div>

      <Section title="Not scheduled">
        <p className="muted small">Tap a day to plan a task for it this week. Tasks with open steps are planned through their steps.</p>
        {projectOrder.length === 0 && <Empty>Everything open is scheduled.</Empty>}
        {projectOrder.map((pid) => (
          <div key={pid} className="group">
            <h3>{projectName(data, pid || null)}</h3>
            {groups.get(pid)!.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                actions={
                  <span className="day-chips">
                    {days.map((d) => (
                      <button key={d} className="mini" disabled={d < day} onClick={() => dispatch({ type: "updateTask", id: t.id, patch: { scheduled: d } })}>
                        {fmtDay(d, { weekday: "narrow" })}
                      </button>
                    ))}
                  </span>
                }
              />
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}
