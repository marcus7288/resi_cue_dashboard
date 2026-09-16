import { describe, expect, it } from "vitest";
import { buildPayload, renderTemplate, sanitizeRef, sendCue } from "./transport";
import { defaultConfig } from "./storage";

const config = defaultConfig();
const cue = { ...config.cues[1]!, ref: "1/3" };
const site = { ...config.sites[1]!, venueId: "venue-7", channelId: "chan-3", ref: "2" };
const AIR = Date.parse("2026-09-20T15:30:00.000Z");

describe("buildPayload", () => {
  it("carries the identifiers the receiver needs", () => {
    const p = buildPayload(cue, site, AIR);
    expect(p.cueId).toBe(cue.id);
    expect(p.venueId).toBe("venue-7");
    expect(p.channelId).toBe("chan-3");
    expect(p.airTime).toBe("2026-09-20T15:30:00.000Z");
  });

  it("carries the control refs used for per-cue routing", () => {
    const p = buildPayload(cue, site, AIR);
    expect(p.cueRef).toBe("1/3");
    expect(p.siteRef).toBe("2");
  });
});

describe("sanitizeRef", () => {
  it("keeps slashes, because Companion addresses page/row/column", () => {
    expect(sanitizeRef("2/1/3")).toBe("2/1/3");
  });
  it("allows letters, digits, hyphen and underscore", () => {
    expect(sanitizeRef("stage_left-2/A1")).toBe("stage_left-2/A1");
  });
  it("strips a query string that would change the request", () => {
    expect(sanitizeRef("1/3?evil=1")).toBe("1/3evil1");
  });
  it("strips a fragment", () => {
    expect(sanitizeRef("1/3#frag")).toBe("1/3frag");
  });
  it("strips dot segments so a ref cannot climb the path", () => {
    expect(sanitizeRef("../../admin")).toBe("/admin");
    expect(sanitizeRef("1/../2")).toBe("1/2");
  });
  it("neutralises a scheme so the ref cannot become an absolute URL", () => {
    const out = sanitizeRef("https://evil.example/x");
    expect(out).toBe("https/evilexample/x");
    expect(out).not.toContain("://");
  });
  it("strips userinfo", () => {
    expect(sanitizeRef("user@evil.example")).toBe("userevilexample");
  });
  it("collapses repeated slashes so a protocol-relative host cannot form", () => {
    const out = sanitizeRef("//evil.example");
    expect(out).toBe("/evilexample");
    expect(out.startsWith("//")).toBe(false);
  });
  it("strips whitespace and control characters", () => {
    expect(sanitizeRef("1 / 3\n")).toBe("1/3");
  });
});

describe("renderTemplate", () => {
  const p = buildPayload(cue, site, AIR);

  it("builds a Companion button URL from site and cue refs", () => {
    expect(
      renderTemplate("http://companion.local:8000/api/location/{siteRef}/{cueRef}/press", p),
    ).toBe("http://companion.local:8000/api/location/2/1/3/press");
  });

  it("substitutes Resi identifiers", () => {
    expect(renderTemplate("/v1/venues/{venueId}/channels/{channelId}/{cueType}", p)).toBe(
      "/v1/venues/venue-7/channels/chan-3/video-start",
    );
  });

  it("URI-encodes opaque ids so one cannot escape its path segment", () => {
    const evil = buildPayload(cue, { ...site, channelId: "../admin" }, AIR);
    const rendered = renderTemplate("/v1/channels/{channelId}", evil);
    expect(rendered).toBe("/v1/channels/..%2Fadmin");
    expect(rendered).not.toContain("../");
  });

  it("sanitises refs rather than encoding them, keeping path structure", () => {
    const evil = buildPayload({ ...cue, ref: "1/3?x=1" }, site, AIR);
    const rendered = renderTemplate("http://c:8000/api/location/{siteRef}/{cueRef}/press", evil);
    expect(rendered).not.toContain("?");
    expect(rendered).toBe("http://c:8000/api/location/2/1/3x1/press");
  });

  it("leaves unknown placeholders verbatim so the mistake is visible", () => {
    expect(renderTemplate("/v1/{nope}", p)).toBe("/v1/{nope}");
  });

  it("substitutes every occurrence", () => {
    expect(renderTemplate("{cueRef}-{cueRef}", p)).toBe("1/3-1/3");
  });

  it("renders an empty ref without leaving the placeholder behind", () => {
    const bare = buildPayload({ ...cue, ref: "" }, { ...site, ref: "" }, AIR);
    expect(renderTemplate("/api/{siteRef}/{cueRef}/press", bare)).toBe("/api///press");
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

  it("POSTs to the rendered per-cue URL, not the raw template", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const result = await sendCue(
        {
          ...config.transport,
          mode: "webhook",
          webhookUrl: "http://companion.local:8000/api/location/{siteRef}/{cueRef}/press",
        },
        cue,
        site,
        AIR,
      );
      expect(result.ok).toBe(true);
      expect(calls).toEqual(["http://companion.local:8000/api/location/2/1/3/press"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reports a failing webhook status as a failure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    try {
      const result = await sendCue(
        { ...config.transport, mode: "webhook", webhookUrl: "http://x/{cueRef}" },
        cue,
        site,
        AIR,
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toContain("404");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("explains a 401 from the proxy in terms of the shared secret", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("Unauthorized", { status: 401 })) as typeof fetch;
    try {
      const result = await sendCue({ ...config.transport, mode: "resi" }, cue, site, AIR);
      expect(result.ok).toBe(false);
      expect(result.detail).toContain("VITE_DASHBOARD_SECRET");
    } finally {
      globalThis.fetch = original;
    }
  });
});
