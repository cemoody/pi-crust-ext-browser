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

Current state (`31 passed | 40 todo`, tsc clean):
- ✅ `input-mapper` (INP-1/3/5/6) — 7 green.
- ✅ `browser-service` (LIFE/STR/MUX/SEC/ERR) — 14 green.
- ✅ `handoff` (HOFF-*) — 6 green.
- ✅ `redaction` (TOOL-5/SEC-3) — 4 green.
- ⏳ `todo`: contract (gateway), widget (jsdom), tools (fake-pi), perf/resilience,
  e2e (real browser) — scaffolded with ID-tagged `it.todo`s; fill as harnesses land.

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
3. Realtime `browser:*` transport → extend the core realtime harness, fill the
   contract `it.todo`s.
4. `pi.extensions` tools (RPC) + `prc/server.ts` (routes/activities) → tools `it.todo`s.
5. `web/widget.mjs` (canvas viewer) → widget `it.todo`s under jsdom.
6. Real-browser golden e2e → e2e `it.todo`s (headless + headful).

Every P0 criterion must have a green test in its layer before GA; every 🟢
invariant gets a dedicated regression guard. Track ID → test file in the
coverage matrix.
```
