# Resi Cue Dashboard

A service-cueing dashboard for a multi-site church running video venues on
[studio.resi.io](https://studio.resi.io). It solves one specific problem well:
**getting the video portion of the service to start seamlessly at a lag
(secondary) site that is running behind the broadcast campus.**

Three sections:

| Tab | What it does |
| --- | --- |
| **Run of show** | Big GO button, live countdown to the next cue, per-cue fire/skip, activity log. |
| **Video alignment** | Frame-accurate scrubber that sets where the video portion starts, and shows the resulting wall-clock start time for every lag site. |
| **Admin** | Sites, lag offsets, cues, delivery mode, timeline settings, import/export. |

---

## The timing model

Everything in the app derives from four numbers.

```
air time at a site = service start
                   + program time      (where the cue sits in the service)
                   + site lag          (how far behind the primary this site runs)
                   + site trim         (measured signal-chain correction, ms)

send time          = air time − pre-roll   (how early the command must leave)
```

- **Program time** — position in the service, measured from `t=0` (service start).
- **Lag** — e.g. North Campus runs 30 minutes behind, so `lagSeconds = 1800`.
  The primary site is the reference and always has a lag of 0.
- **Trim** — per-site fine correction in milliseconds for encoder/decoder
  latency. Set it by ear with **Tap on air**, or type it directly.
- **Pre-roll** — commands do not land instantly. Pre-roll is subtracted from
  every air time so the action hits air on schedule rather than late.

A consequence worth internalising: **cues do not fire in run-of-show order.**
With a 30-minute lag, the lag site's opening cue lands *after* the primary's
25-minute sermon cue. The Run of Show table is therefore sorted by send time,
not by program time, so the list you read top-to-bottom is the order things
actually happen.

### Tap on air

During a service, press **Tap on air** the moment the lag site's video actually
hits air. The app compares that against the predicted moment and writes the
difference back as that site's trim, so the next service is closer. Taps more
than 60 seconds from the prediction are rejected rather than applied — that far
off means the *lag* is wrong, not the trim.

---

## Cue delivery modes

Set in **Admin → Cue delivery**.

- **`simulate`** (default) — nothing leaves the browser. Cues are logged as if
  sent. Use it for rehearsal, volunteer training, and any dry run.
- **`webhook`** — POSTs a JSON payload to any HTTPS URL. This is the mode most
  churches will actually use, because it drives Bitfocus Companion,
  ProPresenter, or an automation hook directly.
- **`resi`** — POSTs through a serverless function that holds the Resi API
  token server-side.

> **Read this before going live in `resi` mode.** The endpoint template shipped
> in the config is a **placeholder**, not a verified Resi API path. Confirm the
> real path, HTTP method, authentication scheme and body shape against current
> Resi API documentation, then set the template in Admin. The app is built so
> this is a configuration change, not a code change.

The payload sent in `webhook` and `resi` modes:

```json
{
  "cueId": "cue-video-start",
  "cueLabel": "Roll sermon video",
  "cueType": "video-start",
  "siteId": "site-lag-1",
  "siteName": "North Campus (lag)",
  "venueId": "…",
  "channelId": "…",
  "airTime": "2026-09-20T15:55:00.000Z",
  "programTimeSec": 1500,
  "sentAt": "2026-09-20T15:54:58.500Z"
}
```

---

## Security notes

The API token is never held in the browser. A token shipped to the client is
readable by anyone with the page open and by any script running on it — so in
`resi` mode the browser only names a *path* and a *payload*, and
`netlify/functions/resi-proxy.mjs` attaches the credential server-side.

Because the browser supplies that path, the proxy validates it strictly
(`netlify/functions/lib/validate.mjs`). Without validation the function would be
an open relay that attaches a real token to any destination an attacker names.
It rejects absolute URLs, protocol-relative paths, embedded schemes, userinfo,
backslashes, path traversal (raw and percent-encoded), control characters and
CRLF injection, and it forwards only POST and PUT with `redirect: "manual"` so a
redirect cannot carry the token to another host. These rules are covered by 23
tests.

Set `DASHBOARD_SHARED_SECRET` in production. Without it, the function is
reachable by anyone who knows the URL.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 95 unit tests
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build to dist/
```

## Deploying to Netlify

1. Push this repo and connect it as a new Netlify site. `netlify.toml` already
   sets the build command, publish directory, functions directory, SPA
   fallback and security headers — no manual configuration needed.
2. For `resi` mode only, set **Site settings → Environment variables**:

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `RESI_API_BASE` | yes | API origin, e.g. `https://api.resi.io`, no trailing slash |
   | `RESI_API_TOKEN` | yes | Bearer credential. Server-side only. |
   | `DASHBOARD_SHARED_SECRET` | strongly recommended | Callers must send a matching `X-Dashboard-Secret` header |

   `simulate` and `webhook` modes need no environment variables at all.

## Deploying to CodeSandbox

Import the repo; it is detected as a Vite project and runs `npm run dev`
directly. Netlify Functions do not run there, so `resi` mode will not work in
CodeSandbox — use `simulate` or `webhook`.

---

## Configuration storage

Settings are stored in this browser's `localStorage` under
`resi-cue-dashboard.config.v1`. They do not sync between machines — use
**Export config** / **Import config** to move a setup to the booth machine, and
keep an exported copy as a backup.

Anything read back out of storage is treated as untrusted input and coerced
field by field, so a corrupted or hand-edited blob degrades to defaults instead
of crashing the dashboard mid-service.

---

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | GO — fire the next cue |
| `Esc` | Disarm a pending confirmation |
| `←` `→` | Scrub, when the timeline slider has focus |

With **Require a confirming second press** enabled (the default), the first GO
in a live mode arms the button and the second one fires. In `simulate` mode GO
fires immediately.

---

## Project layout

```
src/lib/time.ts         timecode parsing/formatting, air & send time math
src/lib/cueEngine.ts    schedule building, next/missed cue, config validation
src/lib/transport.ts    cue delivery across the three modes
src/lib/storage.ts      defensive config load/save
src/components/         Scrubber, CuePanel, AdminPanel, TimeField
src/hooks/              useClock, useConfig, useCueRunner
netlify/functions/      Resi proxy + endpoint validation
```

The timing math, scheduling, validation, config coercion and proxy validation
are pure functions with no React dependency — that is where the tests live.
