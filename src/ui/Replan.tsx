import { useState } from "react";
import { addDays, diffDays, fmtDay, type Day } from "../core/dates";
import { fmtMinutes } from "../core/model";
import { plannedInOrder, REPLAN_DEFAULT_EST, restartPlan } from "../core/replan";
import { Dialog } from "./common";
import { useTaskLube } from "./context";

/** "2 days after the deadline (Nov 15)" and the like. */
function versus(last: Day, deadline: Day, label: string): string {
  const n = diffDays(last, deadline);
  const when = `${label} (${fmtDay(deadline)})`;
  if (n === 0) return `on the ${when}`;
  return `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} ${n > 0 ? "after" : "before"} the ${when}`;
}

/**
 * Preview and apply a restarted project plan: the slipped tasks move forward in order,
 * within the daily capacity guideline. Nothing changes until "Move" is pressed.
 */
export function ReplanDialog({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const { data, dispatch, day } = useTaskLube();
  const [tomorrow, setTomorrow] = useState(false);
  const project = data.projects.find((p) => p.id === projectId);
  const start = tomorrow ? addDays(day, 1) : day;
  const plan = project ? restartPlan(data, project.id, start) : null;
  const close = () => {
    setTomorrow(false);
    onClose();
  };
  const cap = data.settings.capacityHours * 60;
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const lastSubmittable = plan
    ? plannedInOrder(data, project!.id)
        .filter((t) => t.version === "submittable")
        .map((t) => plan.moves.find((m) => m.id === t.id)?.to ?? t.scheduled!)
        .sort()
        .pop()
    : undefined;

  return (
    <Dialog open={!!project} onClose={close} title="Restart the plan" wide>
      {project && plan && (
        <div className="form">
          <p>
            <strong>{project.name}</strong>: the open tasks from earlier days move forward, in order, filling up to {data.settings.capacityHours}h of estimates a day
            (counting what's already planned). Later tasks move only if they have to.
          </p>
          <div className="chips-row">
            <span className="muted small">Start</span>
            <button className={!tomorrow ? "pill is-on" : "pill"} onClick={() => setTomorrow(false)}>
              Today
            </button>
            <button className={tomorrow ? "pill is-on" : "pill"} onClick={() => setTomorrow(true)}>
              Tomorrow
            </button>
          </div>
          {plan.moves.length ? (
            <div className="replan-days">
              {Object.entries(plan.load).map(([d, load]) => (
                <div key={d} className="replan-day">
                  <div className="replan-day-head">
                    {fmtDay(d, { weekday: "short", month: "short", day: "numeric" })}
                    <span className="muted">
                      {" "}
                      · {fmtMinutes(load)} planned{load > cap ? " (over the guideline)" : ""}
                    </span>
                  </div>
                  {plan.moves
                    .filter((m) => m.to === d)
                    .map((m) => (
                      <div key={m.id} className="replan-task">
                        {byId.get(m.id)?.title}
                        <span className="muted small"> · from {fmtDay(m.from)}</span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Nothing needs to move.</p>
          )}
          {plan.last && (
            <p className="hint">
              Last task {fmtDay(plan.last, { weekday: "short", month: "short", day: "numeric" })}
              {project.deadline ? `, ${versus(plan.last, project.deadline, "deadline")}` : ""}.
              {project.internalDeadline && lastSubmittable ? ` Last Submittable task ${fmtDay(lastSubmittable)}, ${versus(lastSubmittable, project.internalDeadline, "internal deadline")}.` : ""}
            </p>
          )}
          {plan.unestimated > 0 && (
            <p className="hint">
              {plan.unestimated} task{plan.unestimated === 1 ? " has" : "s have"} no estimate and count{plan.unestimated === 1 ? "s" : ""} as {fmtMinutes(REPLAN_DEFAULT_EST)}.
            </p>
          )}
          <div className="form-foot">
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!plan.moves.length}
              onClick={() => {
                dispatch({ type: "replan", projectId: project.id, moves: plan.moves.map((m) => ({ id: m.id, scheduled: m.to })) });
                close();
              }}
            >
              Move {plan.moves.length} task{plan.moves.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
