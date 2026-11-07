import { useLayoutEffect, useRef, useState } from "react";
import { addDays, fmtDay, weekDays, weekStart } from "../core/dates";
import { fmtMinutes, isOpen, type Task } from "../core/model";
import { dayStats, timeSpent } from "../core/stats";
import { Bar, Dialog, Empty, Section, TaskRow, projectName } from "./common";
import { useTaskLube } from "./context";

export function Week() {
  const { data, dispatch, day } = useTaskLube();
  const [offset, setOffset] = useState(0);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const start = addDays(weekStart(day), offset * 7);
  const days = weekDays(start);
  const strip = useRef<HTMLDivElement>(null);

  // Open on yesterday / today / tomorrow (or Monday for other weeks), aligned to a card edge
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const cards = [...el.querySelectorAll<HTMLElement>(".week-card")];
    if (!cards.length) return;
    const i = cards.findIndex((c) => c.classList.contains("is-today"));
    const target = cards[i <= 0 ? 0 : i - 1];
    el.scrollLeft = target.offsetLeft - cards[0].offsetLeft;
  }, [start]);

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
        <button className="btn" onClick={() => setOffset(offset - 1)} aria-label="Previous week">
          ←
        </button>
        <strong>
          {fmtDay(days[0])} – {fmtDay(days[6])}
        </strong>
        <button className="btn" onClick={() => setOffset(offset + 1)} aria-label="Next week">
          →
        </button>
        {offset !== 0 && (
          <button className="btn" onClick={() => setOffset(0)}>
            This week
          </button>
        )}
      </div>

      <div className="week-strip" ref={strip}>
        {days.map((d) => (
          <DayCard key={d} d={d} onOpen={() => setOpenDay(d)} />
        ))}
      </div>

      <Section title="Not scheduled">
        <p className="muted small">Tap a day letter to plan a task for it this week. Tasks with open steps are planned through their steps.</p>
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

      <WeekDayDialog day={openDay} onClose={() => setOpenDay(null)} />
    </div>
  );
}

/** Summary of one day: done/planned, estimate vs. guideline, time spent. Tap for the task list. */
function DayCard({ d, onOpen }: { d: string; onOpen: () => void }) {
  const { data, day } = useTaskLube();
  const capMin = data.settings.capacityHours * 60;
  const scheduled = data.tasks.filter((t) => t.scheduled === d && t.status !== "dropped");
  const est = scheduled.reduce((a, t) => a + (t.est ?? 0), 0);
  const spent = d <= day ? timeSpent(data, d).minutes : 0;
  // Past days use the record (it remembers tasks moved away); today and later use what's scheduled
  const rec = d <= day ? dayStats(data.days[d]) : null;
  const planned = rec?.planned ?? scheduled.length;
  const done = rec?.done ?? scheduled.filter((t) => t.status === "done").length;
  const past = d < day;

  return (
    <button className={`week-card${d === day ? " is-today" : ""}${past ? " is-past" : ""}`} onClick={onOpen}>
      <span className="week-card-day">
        {fmtDay(d, { weekday: "short" })} <span className="muted">{fmtDay(d, { day: "numeric" })}</span>
        {d === day && <span className="badge today-badge">Today</span>}
      </span>
      {planned ? (
        <span className="week-card-big">
          {past || d === day ? `${done}/${planned}` : planned}
          <span className="muted small">{past || d === day ? " done" : planned === 1 ? " task" : " tasks"}</span>
        </span>
      ) : (
        <span className="week-card-empty">Nothing planned</span>
      )}
      <Bar pct={Math.min(1, est / capMin)} />
      <span className={est > capMin ? "small over" : "small muted"}>
        est {fmtMinutes(est) || "0m"} of {data.settings.capacityHours}h
      </span>
      <span className="small muted">{spent ? `spent ${fmtMinutes(spent)}` : " "}</span>
    </button>
  );
}

/** Everything for one day: planned tasks (can be checked off here) and other tasks finished that day. */
function WeekDayDialog({ day: d, onClose }: { day: string | null; onClose: () => void }) {
  const { data, day } = useTaskLube();
  if (!d) return <Dialog open={false} onClose={onClose} title="" children={null} />;
  const scheduled = data.tasks.filter((t) => t.scheduled === d).sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || a.order - b.order);
  const finishedElsewhere = data.tasks.filter((t) => t.status === "done" && t.doneOn === d && t.scheduled !== d);
  const rec = data.days[d];
  const movedAway = (rec?.planned ?? []).filter((id) => !scheduled.some((t) => t.id === id) && !rec!.done.includes(id));
  const spent = timeSpent(data, d);
  const st = d <= day ? dayStats(rec) : null;
  const est = scheduled.filter((t) => t.status !== "dropped").reduce((a, t) => a + (t.est ?? 0), 0);

  return (
    <Dialog open onClose={onClose} title={fmtDay(d, { weekday: "long", month: "short", day: "numeric" })} wide>
      <div className="form">
        <p className="muted small">
          {st ? `${st.done} of ${st.planned} planned done (${Math.round(st.pct * 100)}%) · ` : ""}
          est {fmtMinutes(est) || "0m"} of {data.settings.capacityHours}h
          {spent.minutes ? ` · spent ${fmtMinutes(spent.minutes)}` : ""}
          {spent.missing ? ` · ${spent.missing} finished without a time` : ""}
          {movedAway.length ? ` · ${movedAway.length} moved to another day` : ""}
        </p>
        <div>
          <h3>Planned</h3>
          {scheduled.length ? scheduled.map((t) => <TaskRow key={t.id} task={t} showProject />) : <Empty>Nothing planned for this day.</Empty>}
        </div>
        {finishedElsewhere.length > 0 && (
          <div>
            <h3>Also finished this day</h3>
            {finishedElsewhere.map((t) => (
              <TaskRow key={t.id} task={t} showProject showDate />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
