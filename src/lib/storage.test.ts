import { describe, expect, it } from "vitest";
import { coerceConfig, defaultConfig } from "./storage";
import { validateConfig } from "./cueEngine";

describe("coerceConfig", () => {
  it("returns defaults for junk input", () => {
    expect(coerceConfig(null).serviceName).toBe(defaultConfig().serviceName);
    expect(coerceConfig("nope").sites.length).toBeGreaterThan(0);
    expect(coerceConfig(42).cues.length).toBeGreaterThan(0);
  });

  it("round-trips a real config through JSON", () => {
    const original = defaultConfig();
    const restored = coerceConfig(JSON.parse(JSON.stringify(original)));
    expect(restored).toEqual(original);
  });

  it("keeps good fields and repairs bad ones alongside them", () => {
    const c = coerceConfig({
      serviceName: "Christmas Eve",
      sites: [{ id: "a", name: "Main", role: "primary", lagSeconds: 500, trimMs: "oops" }],
      scrubber: { durationSec: -10, fps: 0, videoStartSec: 99999 },
    });
    expect(c.serviceName).toBe("Christmas Eve");
    expect(c.sites[0]!.lagSeconds).toBe(0); // primary is always the reference
    expect(c.sites[0]!.trimMs).toBe(0);
    expect(c.scrubber.durationSec).toBeGreaterThan(0);
    expect(c.scrubber.fps).toBeGreaterThan(0);
    expect(c.scrubber.videoStartSec).toBeLessThanOrEqual(c.scrubber.durationSec);
  });

  it("drops non-object entries from sites and cues", () => {
    const c = coerceConfig({ sites: ["x", null, 3], cues: ["x", null] });
    expect(c.sites).toEqual(defaultConfig().sites); // empty list falls back
    expect(c.cues).toEqual([]);
  });

  it("clamps a negative lag to zero", () => {
    const c = coerceConfig({
      sites: [
        { id: "p", name: "P", role: "primary" },
        { id: "l", name: "L", role: "lag", lagSeconds: -60 },
      ],
    });
    expect(c.sites[1]!.lagSeconds).toBe(0);
  });

  it("rejects an unknown transport mode and cue type", () => {
    const c = coerceConfig({
      transport: { mode: "carrier-pigeon", httpMethod: "DELETE" },
      cues: [{ id: "c", label: "C", type: "explode" }],
    });
    expect(c.transport.mode).toBe("simulate");
    expect(c.transport.httpMethod).toBe("POST");
    expect(c.cues[0]!.type).toBe("custom");
  });

  it("enforces a minimum timeout so a cue cannot hang forever", () => {
    const c = coerceConfig({ transport: { timeoutMs: 1 } });
    expect(c.transport.timeoutMs).toBeGreaterThanOrEqual(500);
  });

  it("produces a config that never throws in the validator", () => {
    for (const junk of [null, 0, "", [], {}, { sites: {} }, { cues: 7 }]) {
      expect(() => validateConfig(coerceConfig(junk))).not.toThrow();
    }
  });
});
