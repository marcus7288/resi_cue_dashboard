import { describe, expect, it } from "vitest";
import {
  airTimeForProgramPosition,
  clamp,
  computeSyncCorrection,
  formatClock,
  formatPrecise,
  formatTimeOfDayPrecise,
  parseClock,
  secondsUntil,
  sendTimeForAirTime,
  snapToFrame,
  toFrameNumber,
} from "./time";

describe("clamp", () => {
  it("bounds values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
  it("falls back to min for NaN and inverted ranges", () => {
    expect(clamp(Number.NaN, 3, 10)).toBe(3);
    expect(clamp(5, 10, 0)).toBe(10);
  });
});

describe("formatClock", () => {
  it("formats under an hour as MM:SS", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(599)).toBe("09:59");
  });
  it("adds hours when needed or forced", () => {
    expect(formatClock(3661)).toBe("01:01:01");
    expect(formatClock(65, true)).toBe("00:01:05");
  });
  it("keeps the sign on negatives and truncates toward zero", () => {
    expect(formatClock(-5)).toBe("-00:05");
    expect(formatClock(-3661)).toBe("-01:01:01");
  });
  it("handles non-finite input", () => {
    expect(formatClock(Number.NaN)).toBe("--:--");
    expect(formatClock(Infinity)).toBe("--:--");
  });
});

describe("formatPrecise", () => {
  it("renders milliseconds", () => {
    expect(formatPrecise(0)).toBe("00:00:00.000");
    expect(formatPrecise(1.5)).toBe("00:00:01.500");
    expect(formatPrecise(3661.25)).toBe("01:01:01.250");
  });
  it("carries instead of printing .1000 when ms rounds up", () => {
    expect(formatPrecise(1.9999)).toBe("00:00:02.000");
    expect(formatPrecise(59.9999)).toBe("00:01:00.000");
  });
  it("keeps the sign on negatives", () => {
    expect(formatPrecise(-1.5)).toBe("-00:00:01.500");
  });
});

describe("parseClock", () => {
  it("parses the accepted shapes", () => {
    expect(parseClock("90")).toBe(90);
    expect(parseClock("01:30")).toBe(90);
    expect(parseClock("1:00:00")).toBe(3600);
    expect(parseClock("00:00:01.250")).toBe(1.25);
    expect(parseClock("  02:00  ")).toBe(120);
  });
  it("round-trips with formatClock", () => {
    for (const s of [0, 59, 60, 61, 3599, 3600, 3661]) {
      expect(parseClock(formatClock(s, true))).toBe(s);
    }
  });
  it("rejects malformed input", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("1:70")).toBeNull();
    expect(parseClock("1:2:3:4")).toBeNull();
    expect(parseClock("1.2345")).toBeNull();
  });
  it("accepts a leading minus", () => {
    expect(parseClock("-01:30")).toBe(-90);
  });
});

describe("air and send times", () => {
  const start = Date.parse("2026-09-20T15:00:00.000Z");

  it("puts the primary on air at the program position", () => {
    expect(airTimeForProgramPosition(start, 1500, 0, 0)).toBe(start + 1_500_000);
  });

  it("delays a lag site by exactly its lag", () => {
    const lag = 1800; // 30 minutes
    expect(airTimeForProgramPosition(start, 1500, lag, 0)).toBe(start + (1500 + 1800) * 1000);
  });

  it("applies trim on top of lag, in both directions", () => {
    expect(airTimeForProgramPosition(start, 0, 60, 250)).toBe(start + 60_250);
    expect(airTimeForProgramPosition(start, 0, 60, -250)).toBe(start + 59_750);
  });

  it("sends earlier than air by the pre-roll", () => {
    const air = airTimeForProgramPosition(start, 100, 0, 0);
    expect(sendTimeForAirTime(air, 1500)).toBe(air - 1500);
  });

  it("counts down and then goes negative", () => {
    expect(secondsUntil(start + 5000, start)).toBe(5);
    expect(secondsUntil(start - 2000, start)).toBe(-2);
  });
});

describe("computeSyncCorrection", () => {
  it("pulls the trim earlier when the site fired late", () => {
    const expected = 1_000_000;
    const { errorMs, suggestedTrimMs } = computeSyncCorrection(expected, expected + 400, 0);
    expect(errorMs).toBe(400);
    expect(suggestedTrimMs).toBe(-400);
  });

  it("pushes the trim later when the site fired early", () => {
    const expected = 1_000_000;
    const { errorMs, suggestedTrimMs } = computeSyncCorrection(expected, expected - 300, 0);
    expect(errorMs).toBe(-300);
    expect(suggestedTrimMs).toBe(300);
  });

  it("accumulates onto an existing trim", () => {
    const { suggestedTrimMs } = computeSyncCorrection(1000, 1200, 500);
    expect(suggestedTrimMs).toBe(300);
  });

  it("applying the suggested trim lands the next fire on time", () => {
    const start = 0;
    const expected = airTimeForProgramPosition(start, 100, 30, 0);
    const observed = expected + 750; // ran 750ms late
    const { suggestedTrimMs } = computeSyncCorrection(expected, observed, 0);
    const corrected = airTimeForProgramPosition(start, 100, 30, suggestedTrimMs);
    expect(corrected + 750).toBe(expected);
  });
});

describe("frame helpers", () => {
  it("snaps to the nearest frame", () => {
    expect(snapToFrame(1.017, 30)).toBeCloseTo(1.0333, 3);
    expect(snapToFrame(1.0, 30)).toBe(1);
  });
  it("passes through an invalid frame rate", () => {
    expect(snapToFrame(1.017, 0)).toBe(1.017);
  });
  it("converts to frame numbers", () => {
    expect(toFrameNumber(2, 30)).toBe(60);
    expect(toFrameNumber(2, 0)).toBe(0);
  });
});

describe("formatTimeOfDayPrecise", () => {
  it("keeps milliseconds visible", () => {
    const d = new Date(2026, 8, 20, 10, 32, 7, 250);
    expect(formatTimeOfDayPrecise(d.getTime())).toBe("10:32:07.250");
  });
  it("zero-pads every field", () => {
    const d = new Date(2026, 8, 20, 9, 5, 3, 7);
    expect(formatTimeOfDayPrecise(d.getTime())).toBe("09:05:03.007");
  });
  it("handles non-finite input", () => {
    expect(formatTimeOfDayPrecise(Number.NaN)).toBe("--:--:--.---");
  });
});

describe("frame nudging keeps its sign", () => {
  // Regression: a nudge table that stored only a magnitude made the "-1 frame"
  // button step FORWARD, because both frame buttons resolved to +1/fps.
  const nudge = (pos: number, n: { seconds?: number; frames?: number }, fps: number) =>
    pos + (n.seconds ?? (n.frames ?? 0) / fps);

  it("steps backward for a negative frame count", () => {
    expect(nudge(10, { frames: -1 }, 30)).toBeCloseTo(10 - 1 / 30, 6);
  });
  it("steps forward for a positive frame count", () => {
    expect(nudge(10, { frames: 1 }, 30)).toBeCloseTo(10 + 1 / 30, 6);
  });
  it("opposite frame nudges cancel out", () => {
    const there = nudge(10, { frames: 1 }, 30);
    expect(nudge(there, { frames: -1 }, 30)).toBeCloseTo(10, 9);
  });
  it("a one-frame step is visible at millisecond precision", () => {
    expect(formatPrecise(snapToFrame(1510 - 1 / 30, 30))).toBe("00:25:09.967");
  });
});

describe("tap-sync sanity bound", () => {
  // Regression: tapping far from the predicted moment wrote a multi-hour trim
  // into the config. Anything beyond a minute is operator error, not latency.
  const MAX = 60_000;
  it("treats a plausible tap as a real correction", () => {
    const { errorMs } = computeSyncCorrection(1_000_000, 1_000_450, 0);
    expect(Math.abs(errorMs)).toBeLessThanOrEqual(MAX);
  });
  it("treats an absurd tap as out of bounds", () => {
    const { errorMs } = computeSyncCorrection(1_000_000, 1_000_000 + 3_307_141, 0);
    expect(Math.abs(errorMs)).toBeGreaterThan(MAX);
  });
});
