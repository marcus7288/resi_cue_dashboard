# Integration Guide

Wiring the Resi Cue Dashboard to **Bitfocus Companion** and to **studio.resi.io**.

Work through Step 0 first. It decides where you host the dashboard, and getting
it wrong is the difference between a working Sunday and a dead GO button.

---

## Step 0 — Choose your topology first

A browser is not allowed to do certain things, and those rules decide your
deployment. Both of the following were verified against this dashboard in a
real browser, not assumed:

| Constraint | Effect |
| --- | --- |
| **Mixed content** | A page served over **HTTPS** (Netlify) may not fetch `http://companion.local:8000`. The browser blocks it outright. |
| **CORS** | A cross-origin POST with a JSON body triggers a preflight. If Companion does not answer with `Access-Control-Allow-Origin`, **the request never leaves the browser**. Verified: the mock Companion received nothing and every cue logged `Failed to fetch`. |

So:

> **A Netlify-hosted dashboard cannot drive a Companion on your local network.**
> Not a configuration problem — a browser security rule. Don't fight it.

Pick the row that matches your setup:

| Your situation | Host the dashboard | Cue mode |
| --- | --- | --- |
| Companion on the booth LAN (**most churches**) | **Booth mode** — `npm run booth` on a machine on that LAN | `webhook` → relative `/api/...` |
| Rehearsal, training, volunteer practice | Netlify or booth, either | `simulate` |
| Resi API over the public internet | Netlify | `resi` (through the proxy) |
| A cloud automation endpoint with a real HTTPS certificate | Netlify | `webhook` → that HTTPS URL |

Booth mode fixes both constraints at once by serving the dashboard and
forwarding to Companion **from the same origin**: no preflight, no mixed
content. That is the entire reason `tools/booth-server.mjs` exists.

---

# Part A — Bitfocus Companion

The dashboard is the **timing brain**; Companion is the **execution layer**.
The dashboard decides *when*, Companion knows *how* to talk to your switcher,
playback system and Resi decoders. Keep that split — it is why you do not need
a verified Resi API to go live.

### A1. Enable Companion's HTTP API

1. Open Companion's web admin, normally `http://localhost:8000` (or
   `http://<companion-ip>:8000` from another machine).
2. Go to **Settings**, find the **HTTP / Protocols** section, and enable the
   **HTTP API**. Note the port.
3. Companion's UI shifts between major versions. Whatever your version calls
   it, confirm the exact API path on that Settings page — it is documented
   there. This guide assumes the Companion 3.x/4.x shape:

   ```
   POST /api/location/<page>/<row>/<column>/press
   ```

   Older Companion 2.x used `/press/bank/<page>/<bank>` instead. If you are on
   2.x, use that shape in Step A4 and set your refs accordingly.

**Verify before going further.** From the machine that will run the dashboard:

```bash
curl -X POST http://<companion-ip>:8000/api/location/1/0/0/press
```

A button on page 1, row 0, column 0 should fire. If this curl does nothing,
stop and fix Companion — no dashboard change will help.

### A2. Build one Companion button per action

Lay out your buttons so that **each site gets its own page** and **each cue
occupies the same row/column on every page**. That symmetry is what lets a
single URL address every combination.

| Page | Site | Row/Col 1/3 | Row/Col 1/4 |
| --- | --- | --- | --- |
| 2 | Broadcast Campus | Roll sermon video | Video out |
| 3 | North Campus (lag) | Roll sermon video | Video out |

Each button holds whatever actions that site actually needs — switcher cut,
playback start, Resi decoder action, lighting, however your venue is wired.
The dashboard neither knows nor cares what is inside the button.

### A3. Enter the refs in the dashboard

**Admin → Sites**, set **Control ref {siteRef}** per site:

| Site | Control ref |
| --- | --- |
| Broadcast Campus | `2` |
| North Campus (lag) | `3` |

**Admin → Cues**, set **Control ref {cueRef}** per cue:

| Cue | Control ref |
| --- | --- |
| Roll sermon video | `1/3` |
| Video out / back to live | `1/4` |

Refs are sanitised before use: slashes are kept (they are the page/row/column
structure), but query strings, fragments, schemes, userinfo and `..` segments
are stripped, so a ref cannot be used to redirect the request somewhere else.

### A4. Point the dashboard at Companion

**Admin → Cue delivery → webhook**, then set the URL template:

**Booth mode (recommended):**

```
/api/location/{siteRef}/{cueRef}/press
```

**Direct, only if Companion sends CORS headers and the dashboard is also on
http://:**

```
http://<companion-ip>:8000/api/location/{siteRef}/{cueRef}/press
```

Available placeholders: `{siteRef}`, `{cueRef}`, `{cueType}`, `{cueId}`,
`{siteId}`, `{venueId}`, `{channelId}`.

At fire time the dashboard expands the template per cue **and** per site:

```
Roll sermon video → Broadcast Campus   POST /api/location/2/1/3/press
Roll sermon video → North Campus (lag) POST /api/location/3/1/3/press
```

Both of those were confirmed arriving at a mock Companion during testing.

The full cue payload is also POSTed as the JSON body. Companion ignores it for
a button press, but it is there if you forward to something that wants detail:

```json
{
  "cueLabel": "Roll sermon video", "cueType": "video-start",
  "siteName": "North Campus (lag)", "siteRef": "3", "cueRef": "1/3",
  "airTime": "2026-09-20T15:55:00.000Z", "programTimeSec": 1500
}
```

### A5. Run booth mode

On a machine on the same network as Companion:

```bash
npm install
npm run build
COMPANION_URL=http://127.0.0.1:8000 PORT=3000 npm run booth
```

Open `http://localhost:3000`, or `http://<booth-ip>:3000` from the tech
booth's other machines. The server prints the exact webhook URL to paste into
Admin on startup.

If Companion is unreachable the proxy returns **502** with the reason, and the
cue is logged as **failed** in the activity log. It never reports a silent
success — confirmed in testing.

### A6. Optional — push the countdown onto a Stream Deck

Companion custom variables can display dashboard state on a physical button.
Create a custom variable in Companion, then have your automation set it:

```bash
curl -X POST "http://<companion-ip>:8000/api/custom-variable/next_cue/value?value=T-00:00:30"
```

Confirm the custom-variable path on your Companion version's Settings page
before relying on it; it has changed across releases.

---

# Part B — studio.resi.io

**Read this before you start.** I could not verify Resi's current REST API
endpoints, authentication scheme, or whether a cue-trigger endpoint is exposed
on your plan at all. Rather than print an invented path that would fail live,
the dashboard makes all of it configurable and this section tells you how to
discover and verify the real values.

**Most churches should not need Part B.** If Companion can already drive your
Resi decoders or your playback system, Part A is a complete solution and it is
the proven path. Treat the Resi API as an optimisation, not a prerequisite.

### B1. Collect your venue and channel identifiers

1. Sign in to <https://studio.resi.io>.
2. Open the venue / destination for each campus.
3. Copy its identifier. It is usually visible in the page URL when a venue or
   channel is open, and on the venue's detail panel.
4. In the dashboard: **Admin → Sites → Resi venue id** and
   **Resi channel / decoder id**, per site.

These are stored in your local config only, and are sent as `{venueId}` and
`{channelId}` in the payload.

### B2. Get API access

API access on Resi is account-gated, so this is a conversation, not a settings
toggle. Contact your Resi account representative or support and ask for:

- Whether your plan exposes a **REST API for triggering playback/cues** on a
  decoder or venue — and if not, what the supported automation path is.
- **API credentials** (token or client id/secret) and how to rotate them.
- The **API base URL** (e.g. `https://api.resi.io`).
- The **endpoint, HTTP method and body shape** for starting playback on a
  channel.
- Any **rate limits** and whether scheduled events are preferred over
  on-demand triggers.

Ask specifically about the lag-site case: *"how do I start a delayed playback
at a secondary venue at a precise wall-clock time?"* Resi may answer with
scheduled events rather than a live trigger, which changes your design — the
dashboard would then be your rehearsal/verification tool while Resi's own
scheduler does the firing.

### B3. Verify with curl before touching the dashboard

Never let a live service be the first test of an endpoint.

```bash
curl -i -X POST "https://api.resi.io/<path-from-resi>" \
  -H "Authorization: Bearer $RESI_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channelId":"<your-channel-id>"}'
```

Only move on once you can make a channel do something from the command line.

### B4. Configure the Netlify proxy

The token must never reach the browser. **Netlify → Site settings →
Environment variables:**

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESI_API_BASE` | yes | e.g. `https://api.resi.io`, no trailing slash |
| `RESI_API_TOKEN` | yes | Bearer credential, server-side only |
| `DASHBOARD_SHARED_SECRET` | optional | Callers must send a matching `X-Dashboard-Secret` |
| `VITE_DASHBOARD_SECRET` | only with the above | Build-time value the browser sends. **Must match.** |

**Be honest with yourself about the shared secret.** A static site ships its
JavaScript to the browser, so `VITE_DASHBOARD_SECRET` is readable by anyone who
can load the page and open devtools. It raises the bar from *anyone who knows
the function URL* to *anyone who can load your dashboard* — useful against
opportunistic internet scanning, and **not** access control.

For real access control, protect the whole site: Netlify password protection,
Netlify Identity, or simply don't host the dashboard publicly. If you set
`DASHBOARD_SHARED_SECRET` without also setting `VITE_DASHBOARD_SECRET` at build
time, every cue fails with 401 — the dashboard says so explicitly in the log.

### B5. Configure the dashboard

**Admin → Cue delivery → resi:**

- **Proxy path** — `/.netlify/functions/resi-proxy` (default)
- **Endpoint template** — the path from B2/B3, with placeholders, e.g.
  `/v1/venues/{venueId}/channels/{channelId}/cue`
- **Method** — `POST` or `PUT` per Resi's docs

The proxy rejects anything that is not a plain relative path: absolute URLs,
protocol-relative paths, embedded schemes, userinfo, traversal, control
characters and CRLF. It forwards only POST/PUT and refuses to follow
redirects, so a 302 cannot carry your token to another host.

---

# Part C — Rehearsal and go-live

Do not let Sunday be the first run.

### C1. Dry run in simulate mode

1. **Admin → Cue delivery → simulate.**
2. Enter your real run of show: every cue, real program times.
3. **Admin → Sites:** set each lag site's real lag (e.g. `00:30:00`).
4. **Run of show → Start service clock**, then work the whole service.
5. Confirm the activity log shows every cue at the right moment, and that the
   send order interleaves sites the way you expect.

### C2. Mid-week live test

1. Switch to `webhook`, booth mode running.
2. Fire each cue manually with the **Fire** button, one row at a time.
3. Watch Companion's log and the actual venue output.
4. Keep **Require a confirming second press** enabled.

### C3. Dial in the trim

1. During the test, on **Video alignment**, press **Tap on air** the moment
   the lag site's video actually hits air.
2. The measured error becomes that site's trim.
3. Repeat across a couple of runs until the error is consistently small.
4. Taps more than 60s from the prediction are rejected — that means the *lag*
   is wrong, not the trim.

### C4. Before each service

- [ ] Export your config as a backup (**Admin → Export config**)
- [ ] Booth machine on the same network as Companion, `npm run booth` running
- [ ] Companion reachable — fire one test button
- [ ] Admin shows **Configuration valid** with no errors
- [ ] Lag values match today's actual service offsets
- [ ] Dry-run the first cue in `simulate`, then switch to `webhook`
- [ ] Decide auto-fire vs. manual GO, and tell the operator which

### C5. Auto-fire, honestly

Auto-fire depends on the browser tab staying awake, and background tabs get
throttled by the browser. For a staffed booth with the tab in front, it is
fine. For unattended operation, the scheduling belongs on a server — the
dashboard is not the right tool for that, and pretending otherwise will cost
you a service.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every cue logs `Failed to fetch` | CORS or mixed content | Use booth mode (Step 0) |
| Cues log `Webhook failed: 404` | Wrong page/row/column ref, or that button doesn't exist | Verify with the curl in A1 |
| `502 Cannot reach Companion` | Companion down, or wrong `COMPANION_URL` | Check Companion is running and on the same LAN |
| `Proxy 401 … VITE_DASHBOARD_SECRET` | `DASHBOARD_SHARED_SECRET` set without a matching build-time value | Set both, or neither, then redeploy |
| `Proxy 500 … not configured` | Missing `RESI_API_BASE` / `RESI_API_TOKEN` | Set them in Netlify, then redeploy |
| All cues fire at the same instant | Lag site's lag is `0` | Admin → Sites → set the real lag. Admin warns about this |
| Cues fire in an order that looks wrong | Not wrong — lag interleaves sites | See the timing model in `README.md` |
| Settings vanished | `localStorage` is per-browser, per-machine | Import your exported config |

### Where things live

```
tools/booth-server.mjs            same-origin server for booth deployment
netlify/functions/resi-proxy.mjs  server-side Resi relay, holds the token
netlify/functions/lib/validate.mjs endpoint validation (SSRF guard)
src/lib/transport.ts              cue delivery, URL templating, ref sanitising
```
