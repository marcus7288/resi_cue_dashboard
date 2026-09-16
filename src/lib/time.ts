/**
 * Pure time / timecode helpers.
 *
 * Vocabulary used throughout the app:
 *  - "program time"  seconds from the start of the service program (t=0 = service start).
 *  - "wall clock"    epoch milliseconds (Date.now()).
 *  - "lag"           how far behind the primary site a secondary site runs, in seconds.
 *  - "trim"          per-site fine correction in milliseconds (encoder/decoder latency).
 *  - "pre-roll"      how early a command must be sent so the action lands on air on time.
 */

const MS_PER_SEC = 1000;

/** Clamp `n` into [min, max]. Returns `min` if the range is inverted. */
export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  if (max < min) return min;
  return Math.min(Math.max(n, min), max);
}

/**
 * Format seconds as HH:MM:SS, or MM:SS when under an hour and `forceHours` is false.
 * Negative values keep a leading minus: -00:05.
 */
export function formatClock(totalSeconds: number, forceHours = false): string {
  if (!Number.isFinite(totalSeconds)) return "--:--";
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(totalSeconds);
  const whole = Math.floor(abs);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  if (h > 0 || forceHours) return `${sign}${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${sign}${pad(m)}:${pad(s)}`;
}

/** Format seconds as HH:MM:SS.mmm — used where frame-ish precision matters. */
export function formatPrecise(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "--:--:--.---";
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(totalSeconds);
  const whole = Math.floor(abs);
  const ms = Math.round((abs - whole) * 1000);
  // Rounding 0.9996 upward must not produce ".1000".
  const carry = ms === 1000 ? 1 : 0;
  const w = whole + carry;
  const msOut = carry ? 0 : ms;
  const h = Math.floor(w / 3600);
  const m = Math.floor((w % 3600) / 60);
  const s = w % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${sign}${pad(h)}:${pad(m)}:${pad(s)}.${String(msOut).padStart(3, "0")}`;
}

/**
 * Parse "HH:MM:SS.mmm", "MM:SS", "SS" or a bare number of seconds.
 * Returns null when the input is not a valid duration.
 */
export function parseClock(input: string): number | null {
  const raw = input.trim();
  if (raw === "") return null;
  const neg = raw.startsWith("-");
  const body = neg ? raw.slice(1) : raw;
  if (!/^[0-9]+(:[0-5]?[0-9]){0,2}(\.[0-9]{1,3})?$/.test(body)) return null;

  const parts = body.split(":");
  if (parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value)) return null;
    seconds = seconds * 60 + value;
  }
  return neg ? -seconds : seconds;
}

/** Wall-clock time of day, e.g. "10:32:07 AM", for a given epoch ms. */
export function formatTimeOfDay(epochMs: number, withSeconds = true): string {
  if (!Number.isFinite(epochMs)) return "--:--";
  return new Date(epochMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

/**
 * Wall-clock time of day with milliseconds, 24-hour, e.g. "10:32:07.250".
 * Used where sub-second alignment is the point and a rounded second would
 * hide the very precision the operator just dialled in.
 */
export function formatTimeOfDayPrecise(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return "--:--:--.---";
  const d = new Date(epochMs);
  const pad = (v: number, n = 2) => String(v).padStart(n, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Wall-clock moment a given program position happens AT A SITE.
 *
 * A site running `lagSeconds` behind the primary reaches program position `p`
 * exactly `lagSeconds` after the primary does. `trimMs` is the operator's
 * measured correction for that site's signal-chain latency.
 */
export function airTimeForProgramPosition(
  primaryStartEpochMs: number,
  programTimeSec: number,
  lagSeconds: number,
  trimMs = 0,
): number {
  return primaryStartEpochMs + (programTimeSec + lagSeconds) * MS_PER_SEC + trimMs;
}

/**
 * When the command must LEAVE the dashboard so it lands on air at `airTimeEpochMs`.
 * Pre-roll covers network round-trip plus decoder start latency.
 */
export function sendTimeForAirTime(airTimeEpochMs: number, preRollMs: number): number {
  return airTimeEpochMs - preRollMs;
}

/** Seconds remaining until `targetEpochMs`; negative once the moment has passed. */
export function secondsUntil(targetEpochMs: number, nowEpochMs: number): number {
  return (targetEpochMs - nowEpochMs) / MS_PER_SEC;
}

/**
 * Compare where the lag site actually started against where it was expected to.
 *
 * `observedAirEpochMs` is when the operator saw/tapped the real start.
 * A POSITIVE `errorMs` means the site fired LATE, so the suggested trim is
 * reduced by that amount to pull the next fire earlier.
 */
export function computeSyncCorrection(
  expectedAirEpochMs: number,
  observedAirEpochMs: number,
  currentTrimMs: number,
): { errorMs: number; suggestedTrimMs: number } {
  const errorMs = observedAirEpochMs - expectedAirEpochMs;
  return { errorMs, suggestedTrimMs: Math.round(currentTrimMs - errorMs) };
}

/**
 * Snap a scrub position to a frame boundary so the video portion starts on a
 * whole frame rather than mid-frame.
 */
export function snapToFrame(seconds: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return seconds;
  return Math.round(seconds * fps) / fps;
}

/** Convert a program position to its frame number at the given rate. */
export function toFrameNumber(seconds: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round(seconds * fps);
}
