import { useCallback, useEffect, useState } from "react";
import type { DashboardConfig, ScheduledCue } from "../types";
import type { CueRunner } from "../hooks/useCueRunner";
import { formatClock, formatTimeOfDay, secondsUntil } from "../lib/time";

interface Props {
  config: DashboardConfig;
  runner: CueRunner;
  now: number;
}

const ARM_WINDOW_MS = 5000;

/** True when focus is in a field, so the space bar types instead of firing a cue. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
  );
}

export default function CuePanel({ config, runner, now }: Props) {
  const {
    serviceStart,
    serviceRunning,
    schedule,
    statusOf,
    log,
    autoFire,
    setAutoFire,
    upcoming,
    missed,
    startService,
    stopService,
    fire,
    fireNext,
    skip,
    clearLog,
    busyKey,
  } = runner;

  const [armedUntil, setArmedUntil] = useState(0);
  const isLive = config.transport.mode !== "simulate";
  const needsArm = isLive && config.confirmBeforeFire;
  const isArmed = armedUntil > now;

  const go = useCallback(() => {
    if (!serviceRunning) return;
    if (needsArm && armedUntil <= Date.now()) {
      setArmedUntil(Date.now() + ARM_WINDOW_MS);
      return;
    }
    setArmedUntil(0);
    void fireNext();
  }, [serviceRunning, needsArm, armedUntil, fireNext]);

  // Space bar is the GO key; Escape disarms.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        go();
      } else if (e.code === "Escape") {
        setArmedUntil(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const countdown = upcoming ? secondsUntil(upcoming.sendEpochMs, now) : null;

  const rowClass = (item: ScheduledCue) => {
    const status = statusOf(item.key);
    const classes = ["cue-row", `status-${status}`];
    if (upcoming?.key === item.key) classes.push("is-next");
    if (item.site.role === "lag") classes.push("is-lag");
    return classes.join(" ");
  };

  return (
    <section className="panel" aria-labelledby="show-heading">
      <header className="panel-head">
        <h2 id="show-heading">{config.serviceName} — Run of show</h2>
        <p className="panel-sub">
          Cues are listed in the order they must be sent, which interleaves sites once a lag
          is applied.
        </p>
      </header>

      <div className="transport-bar">
        <div className="row gap wrap">
          {!serviceRunning ? (
            <button type="button" className="btn primary" onClick={() => startService()}>
              Start service clock
            </button>
          ) : (
            <button type="button" className="btn danger ghost" onClick={stopService}>
              Stop &amp; reset
            </button>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={autoFire}
              disabled={!serviceRunning}
              onChange={(e) => setAutoFire(e.currentTarget.checked)}
            />
            Auto-fire
          </label>
          <span className={`mode-chip mode-${config.transport.mode}`}>
            {config.transport.mode === "simulate" ? "SIMULATION" : config.transport.mode.toUpperCase()}
          </span>
        </div>

        <div className="clock-block">
          <span className="clock-label">Service time</span>
          <span className="clock-value mono">
            {serviceStart === null ? "--:--:--" : formatClock((now - serviceStart) / 1000, true)}
          </span>
        </div>
      </div>

      <div className="go-block">
        <button
          type="button"
          className={`go-btn${isArmed ? " armed" : ""}`}
          onClick={go}
          disabled={!serviceRunning || busyKey !== null}
          aria-describedby="go-hint"
        >
          {busyKey !== null ? "SENDING…" : isArmed ? "CONFIRM — GO" : "GO"}
        </button>
        <div className="go-meta">
          <div id="go-hint" className="hint">
            {!serviceRunning
              ? "Start the service clock to enable firing."
              : isArmed
                ? "Press GO again to send. Escape cancels."
                : "Space fires the next cue."}
          </div>
          {upcoming ? (
            <div className="next-up">
              <span className="next-label">Next</span>
              <strong>{upcoming.cue.label}</strong>
              <span className="muted"> → {upcoming.site.name}</span>
              <span className={`countdown${countdown !== null && countdown <= 10 ? " hot" : ""}`}>
                T−{formatClock(Math.max(0, countdown ?? 0), true)}
              </span>
            </div>
          ) : (
            <div className="next-up muted">
              {serviceRunning ? "No cues remaining." : "Idle."}
            </div>
          )}
        </div>
      </div>

      {missed.length > 0 && (
        <div className="alert warn" role="status">
          {missed.length} cue{missed.length === 1 ? "" : "s"} passed without firing. Fire or skip
          {" "}below to clear.
        </div>
      )}

      {!serviceRunning ? (
        <p className="hint">The schedule appears once the service clock starts.</p>
      ) : (
        <table className="table cue-table">
          <thead>
            <tr>
              <th scope="col">Send at</th>
              <th scope="col">Cue</th>
              <th scope="col">Site</th>
              <th scope="col">On air</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((item) => (
              <tr key={item.key} className={rowClass(item)}>
                <td className="mono">{formatTimeOfDay(item.sendEpochMs)}</td>
                <td>
                  <span className={`cue-dot dot-${item.cue.type}`} aria-hidden="true" />
                  {item.cue.label}
                  {item.cue.notes && <div className="cue-note">{item.cue.notes}</div>}
                </td>
                <td>
                  {item.site.name}
                  {item.site.role === "lag" && (
                    <span className="lag-chip">+{formatClock(item.site.lagSeconds, true)}</span>
                  )}
                </td>
                <td className="mono">{formatTimeOfDay(item.airEpochMs)}</td>
                <td>
                  <span className={`status-chip chip-${statusOf(item.key)}`}>
                    {statusOf(item.key)}
                  </span>
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="btn tiny"
                    onClick={() => void fire(item)}
                    disabled={busyKey !== null}
                  >
                    Fire
                  </button>
                  <button
                    type="button"
                    className="btn tiny ghost"
                    onClick={() => skip(item)}
                    disabled={statusOf(item.key) !== "pending"}
                  >
                    Skip
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row between">
        <h3 className="sub-heading">Activity log</h3>
        {log.length > 0 && (
          <button type="button" className="btn tiny ghost" onClick={clearLog}>
            Clear
          </button>
        )}
      </div>
      <ul className="log">
        {log.length === 0 && <li className="muted">Nothing sent yet.</li>}
        {log.map((entry) => (
          <li key={entry.id} className={`log-${entry.status}`}>
            <span className="mono">{formatTimeOfDay(entry.atEpochMs)}</span>
            <strong>{entry.cueLabel}</strong>
            <span className="muted">{entry.siteName}</span>
            <span className="log-detail">{entry.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
