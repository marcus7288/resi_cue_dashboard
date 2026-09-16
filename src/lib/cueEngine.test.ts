import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  lagVideoStart,
  missedEntries,
  nextDue,
  resolveTargets,
  validateConfig,
} from "./cueEngine";
import { defaultConfig } from "./storage";
import type { DashboardConfig } from "../types";

const START = Date.parse("2026-09-20T15:00:00.000Z");

function config(patch: (c: DashboardConfig) => void = () => {}): DashboardConfig {
  const c = defaultConfig();
  patch(c);
  return c;
}

describe("resolveTargets", () => {
  it("returns every enabled site when the cue names none", () => {
    const c = config();
    const cue = c.cues[0]!;
    expect(resolveTargets(cue, c.sites).map((s) => s.id)).toEqual(["site-primary", "site-lag-1"]);
  });

  it("honours an explicit target list", () => {
    const c = config();
    const cue = { ...c.cues[0]!, targetSiteIds: ["site-lag-1"] };
    expect(resolveTargets(cue, c.sites).map((s) => s.id)).toEqual(["site-lag-1"]);
  });

  it("never returns a disabled site, even if explicitly targeted", () => {
    const c = config((x) => {
      x.sites[1]!.enabled = false;
    });
    const cue = { ...c.cues[0]!, targetSiteIds: ["site-lag-1"] };
    expect(resolveTargets(cue, c.sites)).toEqual([]);
  });
});

describe("buildSchedule", () => {
  it("expands each cue across every target site", () => {
    const schedule = buildSchedule(config(), START);
    expect(schedule).toHaveLength(6); // 3 cues x 2 sites
  });

  it("orders by send time, interleaving the lag site", () => {
    const schedule = buildSchedule(config(), START);
    const order = schedule.map((s) => `${s.cue.id}@${s.site.id}`);
    // With a 30-minute lag the two sites interleave: the lag site's 0s and
    // 1500s cues (=1800s, 3300s absolute) fall between the primary's 1500s and
    // 3600s cues. This ordering is the whole reason the operator needs a
    // send-ordered list rather than the run-of-show order.
    expect(order).toEqual([
      "cue-countdown@site-primary",
      "cue-video-start@site-primary",
      "cue-countdown@site-lag-1",
      "cue-video-start@site-lag-1",
      "cue-video-stop@site-primary",
      "cue-video-stop@site-lag-1",
    ]);
  });

  it("skips disabled cues", () => {
    const c = config((x) => {
      x.cues[0]!.enabled = false;
    });
    expect(buildSchedule(c, START)).toHaveLength(4);
  });

  it("forces the primary to zero lag even if the stored value is wrong", () => {
    const c = config((x) => {
      x.sites[0]!.lagSeconds = 999;
    });
    const primary = buildSchedule(c, START).find((s) => s.site.role === "primary")!;
    expect(primary.airEpochMs).toBe(START);
  });

  it("subtracts pre-roll from every send time", () => {
    const c = config((x) => {
      x.transport.preRollMs = 2000;
    });
    for (const item of buildSchedule(c, START)) {
      expect(item.airEpochMs - item.sendEpochMs).toBe(2000);
    }
  });

  it("is deterministic for identical send times", () => {
    const c = config((x) => {
      x.sites[1]!.lagSeconds = 0;
      x.sites[1]!.role = "lag";
    });
    const a = buildSchedule(c, START).map((s) => s.key);
    const b = buildSchedule(c, START).map((s) => s.key);
    expect(a).toEqual(b);
  });
});

describe("nextDue and missedEntries", () => {
  it("finds the next unhandled entry", () => {
    const schedule = buildSchedule(config(), START);
    const due = nextDue(schedule, START - 60_000, new Set());
    expect(due?.key).toBe("cue-countdown:site-primary");
  });

  it("skips handled entries", () => {
    const schedule = buildSchedule(config(), START);
    const handled = new Set(["cue-countdown:site-primary"]);
    expect(nextDue(schedule, START - 60_000, handled)?.key).toBe("cue-video-start:site-primary");
  });

  it("returns null once everything is past or handled", () => {
    const schedule = buildSchedule(config(), START);
    expect(nextDue(schedule, START + 10_000_000, new Set())).toBeNull();
  });

  it("reports missed entries only after the grace window", () => {
    const schedule = buildSchedule(config(), START);
    const first = schedule[0]!;
    expect(missedEntries(schedule, first.sendEpochMs + 1000, new Set(), 2000)).toHaveLength(0);
    expect(missedEntries(schedule, first.sendEpochMs + 3000, new Set(), 2000)).toHaveLength(1);
  });

  it("never reports a handled entry as missed", () => {
    const schedule = buildSchedule(config(), START);
    const handled = new Set(schedule.map((s) => s.key));
    expect(missedEntries(schedule, START + 10_000_000, handled)).toHaveLength(0);
  });
});

describe("lagVideoStart", () => {
  it("is the primary video start plus the site's lag and trim", () => {
    const c = config((x) => {
      x.scrubber.videoStartSec = 1500;
      x.sites[1]!.lagSeconds = 1800;
      x.sites[1]!.trimMs = -250;
    });
    expect(lagVideoStart(c, c.sites[1]!, START)).toBe(START + (1500 + 1800) * 1000 - 250);
    expect(lagVideoStart(c, c.sites[0]!, START)).toBe(START + 1_500_000);
  });
});

describe("validateConfig", () => {
  const errors = (c: DashboardConfig) => validateConfig(c).filter((i) => i.level === "error");
  const warnings = (c: DashboardConfig) => validateConfig(c).filter((i) => i.level === "warning");

  it("passes the shipped default config", () => {
    expect(errors(defaultConfig())).toEqual([]);
  });

  it("flags a missing primary", () => {
    const c = config((x) => {
      x.sites[0]!.role = "lag";
    });
    expect(errors(c).some((i) => i.message.includes("No enabled primary"))).toBe(true);
  });

  it("flags two primaries", () => {
    const c = config((x) => {
      x.sites[1]!.role = "primary";
    });
    expect(errors(c).some((i) => i.message.includes("2 primary sites"))).toBe(true);
  });

  it("warns on a lag site with no lag", () => {
    const c = config((x) => {
      x.sites[1]!.lagSeconds = 0;
    });
    expect(warnings(c).some((i) => i.message.includes("will fire with the primary"))).toBe(true);
  });

  it("flags a cue pointing at a deleted site", () => {
    const c = config((x) => {
      x.cues[0]!.targetSiteIds = ["site-gone"];
    });
    expect(errors(c).some((i) => i.message.includes("no longer exists"))).toBe(true);
  });

  it("warns on a cue past the end of the program", () => {
    const c = config((x) => {
      x.scrubber.durationSec = 600;
      x.scrubber.videoStartSec = 0;
    });
    expect(warnings(c).some((i) => i.message.includes("past the end"))).toBe(true);
  });

  it("requires a webhook URL in webhook mode and prefers HTTPS", () => {
    const empty = config((x) => {
      x.transport.mode = "webhook";
    });
    expect(errors(empty).some((i) => i.field === "transport")).toBe(true);

    const insecure = config((x) => {
      x.transport.mode = "webhook";
      x.transport.webhookUrl = "http://cues.example.org/go";
    });
    expect(warnings(insecure).some((i) => i.message.includes("not HTTPS"))).toBe(true);
  });

  it("requires channel ids in resi mode", () => {
    const c = config((x) => {
      x.transport.mode = "resi";
    });
    expect(errors(c).some((i) => i.message.includes("no channel id"))).toBe(true);
  });

  it("rejects an out-of-range video start", () => {
    const c = config((x) => {
      x.scrubber.videoStartSec = 99_999;
    });
    expect(errors(c).some((i) => i.field === "scrubber")).toBe(true);
  });
});
