# @cemoody/pi-crust-ext-browser

Live remote-browser widget for pi-crust: the LLM drives a remote Chromium via
CDP while the human can watch and type credentials inline. Usually hidden;
revealable from the sidebar, and the LLM can force a live login card into the
transcript.

See the design + test contract in the sibling demo dir:
`../browser-widget-demo/EXTENSION-PLAN.md`, `TEST-PLAN.md`, `ACCEPTANCE-CRITERIA.md`.

## Status: RED scaffold (TDD)

The acceptance criteria are encoded as a runnable, currently-failing test suite.
Implementation proceeds **red → green** against the criterion IDs.

```
npm test            # vitest run (fast suite: unit + contract + widget stubs)
```

Current state (`50 passed | 49 todo`, tsc clean):

**Phase 1 — core brain (green):**
- ✅ `input-mapper` (INP-1/3/5/6) — 7 green.
- ✅ `browser-service` (LIFE/STR/MUX/SEC/ERR) — 14 green.
- ✅ `handoff` (HOFF-*) — 6 green.
- ✅ `redaction` (TOOL-5/SEC-3) — 4 green.

**Phase 2 — transport + wiring (green):**
- ✅ `transport` (DEPLOY-1) — same-origin URL helpers.
- ✅ `live-view-token` (SEC-8/DEPLOY-2) — HMAC session-scoped tokens.
- ✅ `cdp-playwright` (CDP-1/2/3) — real CDP adapter incl. navigation/target follow;
  `createPlaywrightCdpFactory` (CDP-4) connects to `CDP_URL` or launches headful.
- ✅ `browser-gateway` (GW-1/2/3, MUX-2 wire) — browser:* onConnection wiring.

**Phase 3 — wired + running (green):**
- ✅ `widget-transport` (W-GW) — `gateway-client` rides the shared socket; bundled
  `widget.mjs` (sidebar) + `live-card.js` (Tier-B inline card) via esbuild.
- ✅ `routes` (GW-4) — token / live-view / resume / navigate handlers.
- ✅ `server-activate` (HOST-1) — `activate()` wires realtime + factory + routes.
- ✅ `login-artifact` (HOFF-2) + `pi` tools — browser_open/navigate/request_login/wait_for_human.
- ⏳ `todo`: jsdom widget DOM tests, perf/resilience budgets, and the headful e2e job.

### Verified live
Runs inside pi-crust on its OWN realtime gateway (no standalone server): the
sidebar **Browser** activity streams a remote Chromium (via `PI_CRUST_BROWSER_CDP_URL`
→ `connectOverCDP`) over `browser:*`; attach ack + JPEG frames confirmed end-to-end.

### Configuration (env)
- `PI_CRUST_BROWSER_CDP_URL` — remote browser CDP endpoint (else launches headful).
- `PI_CRUST_BROWSER_SECRET` — shared secret for live-view tokens.
- `PI_CRUST_BROWSER_HEADLESS=1` — launch headless instead of headful.

Full catalog + phasing: `docs/ACCEPTANCE-CRITERIA.md` (Phase 2 section), `docs/TEST-PLAN.md`.

## Layout

```
src/core/protocol.ts        wire + service types, typed BrowserError
src/core/input-mapper.ts    pure coord/key mapping (DONE)
src/core/redaction.ts       model-safe snapshot redaction (stub)
src/core/browser-service.ts server-owned browser manager (stub)
test/helpers/fake-cdp-session.ts   FakeCdpSession + FakeCdpFactory + RecordingViewer
test/unit/*.test.ts         RED acceptance tests, named "<ID>: <behavior>"
test/contract|widget|e2e/   it.todo scaffolds keyed to IDs
```

The real-browser e2e (`test/e2e/**`) is excluded from the default suite (needs
Chromium + Xvfb); wire it into the browser-enabled CI job.

## Build order (red → green)

1. ✅ `BrowserService` against `FakeCdpSession` (`browser-service` + `handoff` green).
2. ✅ `redactSnapshot` (`redaction` green).
3. ✅ **CDP adapter** (`src/core/cdp-playwright.ts`) — `cdp-playwright` green (CDP-1/2/3).
4. ✅ **Token + transport helpers** (`live-view-token.ts`, `transport.ts`) — green (SEC-8/DEPLOY-1/2).
5. ✅ **Gateway wiring** (`src/prc/realtime.ts`) — `browser-gateway` green (GW-1/2/3).
6. **Widget transport swap** → same-origin browser:* client; fill `widget-transport` todos.
7. `pi.extensions` tools (RPC) + live-view/resume routes → tools `it.todo`s.
8. Real-browser golden e2e (headless + headful) → CDP-2/4, DEPLOY-1/2.

Every P0 criterion must have a green test in its layer before GA; every 🟢
invariant gets a dedicated regression guard. Track ID → test file in the
coverage matrix.
```
