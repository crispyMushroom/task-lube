import { addDays, fmtDay, relDay } from "../core/dates";
import { fmtMinutes, isOpen, type Task } from "../core/model";
import { carriedOver, dayStats, habitWeek, plannedEstimate, projectSummary } from "../core/stats";
import { Bar, Empty, QuickAdd, Section, TaskRow } from "./common";
import { go, useTaskLube } from "./context";

export function Today() {
  const { data, dispatch, day } = useTaskLube();
  const rec = data.days[day];
  const st = dayStats(rec);
  const est = plannedEstimate(rec, data);
  const scheduled = data.tasks.filter((t) => t.scheduled === day);
  const openFirst = (a: Task, b: Task) => Number(!isOpen(a)) - Number(!isOpen(b)) || a.order - b.order;
  const movedAway = (rec?.planned ?? []).filter((id) => !scheduled.some((t) => t.id === id) && !rec!.done.includes(id));
  const extraDone = rec?.extra.length ?? 0;
  const summaries = data.projects.filter((p) => p.status === "active").map((p) => projectSummary(data, p, day));
  const ship = summaries.filter((s) => s.ship);
  const soon = summaries.filter((s) => !s.ship && s.project.deadline && s.project.deadline >= day && s.project.deadline <= addDays(day, 21));
  const passed = summaries.filter((s) => s.project.deadline && s.project.deadline < day);
  const carried = carriedOver(data, day);
  const habits = data.habits.filter((h) => !h.archived);

  return (
    <div className="page">
      <div className="card today-card">
        <div className="today-date">{fmtDay(day, { weekday: "long", month: "long", day: "numeric" })}</div>
        {st ? (
          <>
            <div className="big-stat">
              {st.done} of {st.planned} planned done <span className="muted">· {Math.round(st.pct * 100)}%</span>
            </div>
            <Bar pct={st.pct} />
            <div className="muted small">
              Estimated {fmtMinutes(est.minutes) || "0m"} planned · guideline {data.settings.capacityHours}h
              {est.missing ? ` · ${est.missing} without an estimate` : ""}
              {st.dropped ? ` · ${st.dropped} dropped` : ""}
              {movedAway.length ? ` · ${movedAway.length} moved to another day` : ""}
              {extraDone ? ` · also done (not planned today): ${extraDone}` : ""}
            </div>
          </>
        ) : (
          <div className="muted">Nothing planned for today. Pick tasks in Week, or set "Planned for" on any task.</div>
        )}
      </div>

      <QuickAdd placeholder="Add to inbox…" onAdd={(title) => dispatch({ type: "addTask", task: { title, projectId: null } })} />

      {ship.map((s) => (
        <div key={s.project.id} className="card ship-card">
          <div className="ship-head">
            <span className="badge">Ship mode</span>
            <a href={`#/projects/${s.project.id}`}>{s.project.name}</a>
            <span className="muted"> · deadline {fmtDay(s.project.deadline!)} ({relDay(s.project.deadline!, day)})</span>
          </div>
          {s.submittableOpen.length ? (
            <>
              <div className="muted small">Left for the Submittable version:</div>
              {s.submittableOpen.map((t) => (
                <TaskRow key={t.id} task={t} showDate />
              ))}
              <div className="muted small">Good and Stretch wait until this is done. New ideas go to v2.</div>
            </>
          ) : (
            <div>The Submittable version is complete. Submit it now, or polish with Good tasks until {fmtDay(s.project.deadline!)}.</div>
          )}
        </div>
      ))}

      <Section title="Planned for today">
        {scheduled.length ? scheduled.sort(openFirst).map((t) => <TaskRow key={t.id} task={t} showProject />) : <Empty>Nothing scheduled.</Empty>}
      </Section>

      {habits.length > 0 && (
        <Section title="Habits">
          <div className="habits">
            {habits.map((h) => {
              const on = data.habitLog[day]?.includes(h.id);
              return (
                <button key={h.id} className={on ? "habit is-on" : "habit"} onClick={() => dispatch({ type: "toggleHabit", habitId: h.id })}>
                  <span className="habit-name">
                    {on ? "✓ " : ""}
                    {h.name}
                  </span>
                  <span className="habit-count">
                    {habitWeek(data, h.id, day)} of {h.target} this week
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {carried.length > 0 && (
        <Section title="Carried over">
          {carried.map(({ task, count }) => (
            <TaskRow
              key={task.id}
              task={task}
              showProject
              extra={
                <span className="chip">
                  from {fmtDay(task.scheduled!)} · carried {count}×{count >= 3 ? " · shrink it, reschedule it, or drop it?" : ""}
                </span>
              }
              actions={
                <>
                  <button className="mini" onClick={() => dispatch({ type: "updateTask", id: task.id, patch: { scheduled: day } })}>
                    Today
                  </button>
                  <button className="mini" onClick={() => dispatch({ type: "updateTask", id: task.id, patch: { scheduled: undefined } })}>
                    Unschedule
                  </button>
                  <button className="mini" onClick={() => dispatch({ type: "setStatus", id: task.id, status: "dropped" })}>
                    Drop
                  </button>
                </>
              }
            />
          ))}
        </Section>
      )}

      {(soon.length > 0 || passed.length > 0) && (
        <Section title="Deadlines">
          {soon.map((s) => (
            <div key={s.project.id} className="line">
              <a href={`#/projects/${s.project.id}`}>{s.project.name}</a>
              <span className="muted">
                {" "}
                · deadline {fmtDay(s.project.deadline!)} ({relDay(s.project.deadline!, day)})
                {s.project.internalDeadline ? ` · ship mode from ${fmtDay(s.project.internalDeadline)}` : ""}
                {s.submittable.length ? ` · Submittable ${s.submittable.length - s.submittableOpen.length} of ${s.submittable.length} done` : ""}
              </span>
            </div>
          ))}
          {passed.map((s) => (
            <div key={s.project.id} className="line">
              <a href={`#/projects/${s.project.id}`}>{s.project.name}</a>
              <span className="muted"> · deadline was {fmtDay(s.project.deadline!)}. Mark it submitted or done, or set a new deadline.</span>
            </div>
          ))}
        </Section>
      )}

      {data.projects.length === 0 && data.tasks.length === 0 && (
        <div className="card">
          <p>Start by adding a project or dumping tasks into the inbox.</p>
          <button className="btn primary" onClick={() => go("projects")}>
            Go to projects
          </button>
        </div>
      )}
    </div>
  );
}
