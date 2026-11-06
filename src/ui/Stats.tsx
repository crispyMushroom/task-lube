import type { ReactNode } from "react";
import { addDays, fmtDay, parseDay, weekStart } from "../core/dates";
import { fmtMinutes } from "../core/model";
import { dayStats, estimateReport, projectGrowth, recentAverage } from "../core/stats";
import { Dialog, Empty, Section, projectName } from "./common";
import { useTaskLube, useUi } from "./context";

interface Cell {
  cls: string;
  label: string;
  onClick?: () => void;
}

/** Git-style grid: columns are weeks (Mon–Sun), newest on the right. */
function Heatmap({ weeks, cell, legend }: { weeks: number; cell: (day: string) => Cell; legend?: ReactNode }) {
  const { day } = useTaskLube();
  const start = addDays(weekStart(day), -(weeks - 1) * 7);
  const cols = Array.from({ length: weeks }, (_, w) => addDays(start, w * 7));
  let lastMonth = -1;
  return (
    <div className="heat-wrap">
      <div className="heat">
        <div className="heat-labels">
          <span />
          {["Mon", "", "Wed", "", "Fri", "", ""].map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
        {cols.map((ws) => {
          const m = parseDay(ws).getMonth();
          const label = m !== lastMonth ? parseDay(ws).toLocaleDateString(undefined, { month: "short" }) : "";
          lastMonth = m;
          return (
            <div key={ws} className="heat-col">
              <span className="heat-month">{label}</span>
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(ws, i);
                if (d > day) return <span key={d} className="cell future" />;
                const c = cell(d);
                return <span key={d} className={`cell ${c.cls}`} title={c.label} aria-label={c.label} onClick={c.onClick} role={c.onClick ? "button" : undefined} />;
              })}
            </div>
          );
        })}
      </div>
      {legend}
    </div>
  );
}

export function Stats() {
  const { data, day } = useTaskLube();
  const { openDay } = useUi();
  const avg = recentAverage(data, day);
  const est = estimateReport(data, day);
  const habits = data.habits.filter((h) => !h.archived);
  const firstHabitDay = Object.keys(data.habitLog).sort()[0];
  const active = data.projects.filter((p) => p.status === "active");

  return (
    <div className="page">
      <Section title="Planned vs. done">
        <p className="muted small">
          {avg.count
            ? `Last 30 days: ${avg.count} planned day${avg.count === 1 ? "" : "s"} · on average ${Math.round(avg.avg! * 100)}% of the plan done`
            : "No finished planned days yet. Blank squares mean nothing was planned."}
        </p>
        <Heatmap
          weeks={26}
          cell={(d) => {
            const rec = data.days[d];
            const st = dayStats(rec);
            if (!st) return { cls: "none", label: `${fmtDay(d)}: nothing planned` };
            const lvl = st.done === 0 ? 0 : st.pct <= 0.25 ? 1 : st.pct <= 0.5 ? 2 : st.pct <= 0.75 ? 3 : 4;
            return {
              cls: `l${lvl}`,
              label: `${fmtDay(d)}: ${st.done} of ${st.planned} planned done (${Math.round(st.pct * 100)}%)${rec!.src === "backfilled" ? " · reconstructed" : ""}`,
              onClick: () => openDay(d),
            };
          }}
          legend={
            <div className="legend">
              0% {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`cell l${l}`} />)} 100% · <span className="cell none" /> nothing planned · tap a day for details
            </div>
          }
        />
      </Section>

      <Section title="Habits">
        {habits.length === 0 && <Empty>No habits yet. Add them in Settings.</Empty>}
        {habits.map((h) => (
          <div key={h.id} className="habit-heat">
            <h3>
              {h.name} <span className="muted small">target {h.target}/week</span>
            </h3>
            <Heatmap
              weeks={12}
              cell={(d) => {
                const on = data.habitLog[d]?.includes(h.id);
                const before = !firstHabitDay || d < firstHabitDay;
                return { cls: on ? "l4" : "none", label: `${fmtDay(d)}${on ? ": done" : before ? ": before tracking started" : ""}` };
              }}
            />
          </div>
        ))}
      </Section>

      <Section title="Estimates vs. actual (last 30 days)">
        {est.n < 3 ? (
          <Empty>Appears after 3 finished tasks with both an estimate and an actual time (now: {est.n}).</Empty>
        ) : (
          <>
            <p>
              Across {est.n} tasks, actual time was <strong>{est.ratio!.toFixed(1)}×</strong> the estimate.
            </p>
            <p className="muted small">By size: {est.bySize.map((s) => `${s.label} ${s.ratio.toFixed(1)}× (${s.n})`).join(" · ")}</p>
            {est.byProject.length > 0 && (
              <p className="muted small">By project: {est.byProject.map((s) => `${projectName(data, s.projectId)} ${s.ratio.toFixed(1)}×`).join(" · ")}</p>
            )}
          </>
        )}
      </Section>

      <Section title="Project size over time">
        <p className="muted small">Total tasks (line) and done tasks (filled) per day. A rising line means the project grew.</p>
        {active.map((p) => (
          <Growth key={p.id} name={p.name} points={projectGrowth(data, p.id)} />
        ))}
      </Section>
    </div>
  );
}

function Growth({ name, points }: { name: string; points: { day: string; total: number; done: number }[] }) {
  if (points.length < 2)
    return (
      <div className="growth">
        <span>{name}</span>
        <span className="muted small"> · not enough days recorded yet</span>
      </div>
    );
  const W = 240;
  const H = 40;
  const max = Math.max(...points.map((p) => p.total), 1);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - (v / max) * (H - 2) - 1;
  const line = points.map((p, i) => `${x(i)},${y(p.total)}`).join(" ");
  const area = `0,${H} ` + points.map((p, i) => `${x(i)},${y(p.done)}`).join(" ") + ` ${W},${H}`;
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div className="growth">
      <div>
        {name}{" "}
        <span className="muted small">
          {first.total} → {last.total} tasks since {fmtDay(first.day)} · {last.done} done
        </span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="spark">
        <polygon points={area} className="spark-done" />
        <polyline points={line} className="spark-total" fill="none" />
      </svg>
    </div>
  );
}

export function DayDialog({ day, onClose }: { day: string | null; onClose: () => void }) {
  const { data } = useTaskLube();
  const rec = day ? data.days[day] : undefined;
  const st = dayStats(rec);
  const habits = day ? (data.habitLog[day] ?? []).map((id) => data.habits.find((h) => h.id === id)?.name ?? id) : [];
  return (
    <Dialog open={!!day} onClose={onClose} title={day ? fmtDay(day, { weekday: "long", month: "short", day: "numeric" }) : ""}>
      {day && (
        <div className="form">
          {!st ? (
            <p className="muted">Nothing was planned for this day.</p>
          ) : (
            <>
              <p>
                {st.done} of {st.planned} planned done ({Math.round(st.pct * 100)}%){st.dropped ? ` · ${st.dropped} dropped` : ""}
              </p>
              {rec!.src === "backfilled" && <p className="muted small">Reconstructed later from tasks still scheduled on this day.</p>}
              <ul className="day-list">
                {Object.entries(rec!.planned).map(([id, p]) => {
                  const state = rec!.done.includes(id) ? "done" : rec!.dropped.includes(id) ? "dropped" : "not done";
                  const t = data.tasks.find((x) => x.id === id);
                  return (
                    <li key={id} className={`state-${state.replace(" ", "-")}`}>
                      {p.title} <span className="muted small">({projectName(data, p.projectId)}{p.est ? `, est ${fmtMinutes(p.est)}` : ""}{t?.took ? `, took ${fmtMinutes(t.took)}` : ""}): {state}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {rec && Object.keys(rec.extra).length > 0 && (
            <>
              <p>Also done (not planned for this day):</p>
              <ul className="day-list">
                {Object.entries(rec.extra).map(([id, e]) => (
                  <li key={id}>{e.title}</li>
                ))}
              </ul>
            </>
          )}
          {habits.length > 0 && <p className="muted small">Habits: {habits.join(", ")}</p>}
        </div>
      )}
    </Dialog>
  );
}
