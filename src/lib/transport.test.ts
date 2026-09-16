import { describe, expect, it } from "vitest";
import { buildPayload, renderEndpoint, sendCue } from "./transport";
import { defaultConfig } from "./storage";

const config = defaultConfig();
const cue = config.cues[1]!;
const site = { ...config.sites[1]!, venueId: "venue-7", channelId: "chan-3" };
const AIR = Date.parse("2026-09-20T15:30:00.000Z");

describe("buildPayload", () => {
  it("carries the identifiers the receiver needs", () => {
    const p = buildPayload(cue, site, AIR);
    expect(p.cueId).toBe(cue.id);
    expect(p.venueId).toBe("venue-7");
    expect(p.channelId).toBe("chan-3");
    expect(p.airTime).toBe("2026-09-20T15:30:00.000Z");
  });
});

describe("renderEndpoint", () => {
  it("substitutes every placeholder", () => {
    const p = buildPayload(cue, site, AIR);
    expect(renderEndpoint("/v1/venues/{venueId}/channels/{channelId}/{cueType}", p)).toBe(
      "/v1/venues/venue-7/channels/chan-3/video-start",
    );
  });

  it("URI-encodes values so an id cannot escape its path segment", () => {
    const p = buildPayload(cue, { ...site, channelId: "../admin" }, AIR);
    const rendered = renderEndpoint("/v1/channels/{channelId}", p);
    expect(rendered).toBe("/v1/channels/..%2Fadmin");
    expect(rendered).not.toContain("../");
  });

  it("leaves unknown placeholders alone", () => {
    const p = buildPayload(cue, site, AIR);
    expect(renderEndpoint("/v1/{nope}", p)).toBe("/v1/{nope}");
  });
});

describe("sendCue", () => {
  it("never touches the network in simulate mode", async () => {
    const result = await sendCue(config.transport, cue, site, AIR);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("Simulated");
  });

  it("fails cleanly when webhook mode has no URL", async () => {
    const result = await sendCue(
      { ...config.transport, mode: "webhook", webhookUrl: "  " },
      cue,
      site,
      AIR,
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("No webhook URL");
  });
});
