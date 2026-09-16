import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardConfig } from "../types";
import {
  clamp,
  computeSyncCorrection,
  formatClock,
  formatPrecise,
  formatTimeOfDayPrecise,
  snapToFrame,
  toFrameNumber,
} from "../lib/time";
import { lagVideoStart } from "../lib/cueEngine";

interface Props {
  config: DashboardConfig;
  update: (patch: (draft: DashboardConfig) => DashboardConfig) => void;
  primaryStartEpochMs: number | null;
  serviceRunning: boolean;
}

/**
 * Nudge buttons. `seconds` is an absolute offset; `frames` is resolved against
 * the configured frame rate. Each carries its own sign — a frame nudge must not
 * share a magnitude-only entry with its opposite.
 */
interface Nudge {
  label: string;
  seconds?: number;
  frames?: number;
}

/** Taps further than this from the predicted moment are rejected, not applied. */
const MAX_TAP_ERROR_MS = 60_000;

const NUDGES: Nudge[] = [
  { label: "−1m", seconds: -60 },
  { label: "−10s", seconds: -10 },
  { label: "−1s", seconds: -1 },
  { label: "−1f", frames: -1 },
  { label: "+1f", frames: 1 },
  { label: "+1s", seconds: 1 },
  { label: "+10s", seconds: 10 },
  { label: "+1m", seconds: 60 },
];

export default function Scrubber({ config, update, primaryStartEpochMs, serviceRunning }: Props) {
  const { durationSec, fps, videoStartSec } = config.scrubber;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const mediaSrc = objectUrl ?? config.scrubber.previewUrl.trim();

  // An object URL is a live handle to a blob; release it when it is replaced
  // or the panel unmounts, otherwise the file stays resident for the session.
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  // Keep the preview frame in step with the scrub position.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !mediaSrc) return;
    if (Math.abs(el.currentTime - videoStartSec) > 0.05) {
      try {
        el.currentTime = videoStartSec;
      } catch {
        // Seeking before metadata loads throws in some browsers; the
        // loadedmetadata handler below re-seeks once the media is ready.
      }
    }
  }, [videoStartSec, mediaSrc]);

  const setStart = (next: number) => {
    const bounded = clamp(next, 0, durationSec);
    const value = snap ? snapToFrame(bounded, fps) : bounded;
    update((draft) => {
      draft.scrubber.videoStartSec = Number(value.toFixed(3));
      return draft;
    });
  };

  const nudge = (n: Nudge) => {
    const delta = n.seconds ?? (n.frames ?? 0) / fps;
    setStart(videoStartSec + delta);
  };

  const lagSites = useMemo(
    () => config.sites.filter((s) => s.enabled && s.role === "lag"),
    [config.sites],
  );

  const percent = durationSec > 0 ? (videoStartSec / durationSec) * 100 : 0;

  /**
   * Operator taps when the lag site's video ACTUALLY hit air. The gap against
   * the predicted moment becomes that site's new trim.
   */
  const tapSync = (siteId: string) => {
    if (primaryStartEpochMs === null) {
      setSyncNote("Start the service clock before measuring sync.");
      return;
    }
    const site = config.sites.find((s) => s.id === siteId);
    if (!site) return;
    const expected = lagVideoStart(config, site, primaryStartEpochMs);
    const { errorMs, suggestedTrimMs } = computeSyncCorrection(expected, Date.now(), site.trimMs);

    // A tap is only meaningful near the predicted moment. Anything wildly off
    // means the operator tapped at the wrong time or the lag itself is wrong,
    // and writing that into the trim would quietly corrupt the whole schedule.
    if (Math.abs(errorMs) > MAX_TAP_ERROR_MS) {
      setSyncNote(
        `${site.name}: tap was ${Math.round(Math.abs(errorMs) / 1000)}s from the predicted start — ` +
          `too far off to be a trim. Check the lag value instead. Nothing changed.`,
      );
      return;
    }

    update((draft) => {
      const target = draft.sites.find((s) => s.id === siteId);
      if (target) target.trimMs = suggestedTrimMs;
      return draft;
    });
    setSyncNote(
      `${site.name}: ran ${errorMs >= 0 ? "late" : "early"} by ${Math.abs(errorMs)}ms. ` +
        `Trim set to ${suggestedTrimMs}ms.`,
    );
  };

  return (
    <section className="panel" aria-labelledby="scrubber-heading">
      <header className="panel-head">
        <h2 id="scrubber-heading">Video start alignment</h2>
        <p className="panel-sub">
          Set where the video portion begins on the program timeline. Every lag site&apos;s
          wall-clock start is derived from this point.
        </p>
      </header>

      {mediaSrc ? (
        <video
          ref={videoRef}
          className="preview"
          src={mediaSrc}
          controls
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            try {
              el.currentTime = videoStartSec;
            } catch {
              /* ignore: some sources disallow seeking */
            }
          }}
        />
      ) : (
        <div className="preview preview-empty">
          <span>No preview loaded</span>
          <small>Load a local file below, or set a preview URL in Admin. Optional.</small>
        </div>
      )}

      <div className="row gap">
        <label className="file-btn">
          Load local video
          <input
            type="file"
            accept="video/*"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (!file) return;
              if (objectUrl) URL.revokeObjectURL(objectUrl);
              setObjectUrl(URL.createObjectURL(file));
            }}
          />
        </label>
        {objectUrl && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              URL.revokeObjectURL(objectUrl);
              setObjectUrl(null);
            }}
          >
            Clear preview
          </button>
        )}
      </div>

      <div className="scrub-readout">
        <div className="big-timecode" aria-live="off">
          {formatPrecise(videoStartSec)}
        </div>
        <div className="readout-meta">
          <span>
            frame <strong>{toFrameNumber(videoStartSec, fps)}</strong> @ {fps}fps
          </span>
          <span>
            of <strong>{formatClock(durationSec, true)}</strong>
          </span>
        </div>
      </div>

      <div className="track-wrap">
        {/* Cue markers sit under the slider and never swallow pointer events. */}
        <div className="markers" aria-hidden="true">
          {config.cues
            .filter((c) => c.enabled && durationSec > 0)
            .map((c) => (
              <span
                key={c.id}
                className={`marker marker-${c.type}`}
                style={{ left: `${clamp((c.programTimeSec / durationSec) * 100, 0, 100)}%` }}
                title={`${c.label} — ${formatClock(c.programTimeSec, true)}`}
              />
            ))}
          <span className="marker-playhead" style={{ left: `${clamp(percent, 0, 100)}%` }} />
        </div>
        <input
          className="track"
          type="range"
          min={0}
          max={durationSec}
          step={snap ? 1 / fps : 0.001}
          value={videoStartSec}
          onChange={(e) => setStart(Number(e.currentTarget.value))}
          aria-label="Video start position on the program timeline"
          aria-valuetext={`${formatClock(videoStartSec, true)} of ${formatClock(durationSec, true)}`}
        />
      </div>

      <div className="row gap wrap">
        {NUDGES.map((n) => (
          <button
            key={n.label}
            type="button"
            className="btn nudge"
            onClick={() => nudge(n)}
            title={n.frames !== undefined ? `One frame (${(1000 / fps).toFixed(1)}ms)` : undefined}
          >
            {n.label}
          </button>
        ))}
        <label className="check">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.currentTarget.checked)} />
          Snap to frame
        </label>
      </div>

      <h3 className="sub-heading">Lag site start times</h3>
      {primaryStartEpochMs === null && (
        <p className="hint">
          Start the service clock on the Run of Show tab to see real wall-clock times.
        </p>
      )}
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">Lag</th>
            <th scope="col">Trim</th>
            <th scope="col">Video starts at</th>
            <th scope="col">Sync</th>
          </tr>
        </thead>
        <tbody>
          {lagSites.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No enabled lag sites. Add one in Admin.
              </td>
            </tr>
          )}
          {lagSites.map((site) => (
            <tr key={site.id}>
              <th scope="row">{site.name}</th>
              <td>{formatClock(site.lagSeconds, true)}</td>
              <td className={site.trimMs === 0 ? "muted" : ""}>
                {site.trimMs > 0 ? "+" : ""}
                {site.trimMs}ms
              </td>
              <td className="mono">
                {primaryStartEpochMs === null
                  ? `+${formatClock(config.scrubber.videoStartSec + site.lagSeconds, true)}`
                  : formatTimeOfDayPrecise(lagVideoStart(config, site, primaryStartEpochMs))}
              </td>
              <td>
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => tapSync(site.id)}
                  disabled={!serviceRunning}
                  title="Press the moment this site's video actually hits air"
                >
                  Tap on air
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {syncNote && <p className="sync-note">{syncNote}</p>}
    </section>
  );
}
