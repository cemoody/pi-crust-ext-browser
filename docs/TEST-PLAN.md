# pi-crust-ext-browser — test contract & acceptance criteria

Style mirrors `docs/realtime-socketio-contract.md` and the
`pty-realtime-contract` / `extension-realtime-api` suites. Status legend:
🔴 RED = new surface, fails until built · 🟢 GREEN = invariant that must not regress.

The system has independent seams; each gets the *cheapest deterministic layer*
that can pin it. A real Chromium appears in exactly ONE layer (the golden e2e);
everything else uses a fake CDP so tests are fast and non-flaky.

---

## 1. Test layers (the pyramid)

| Layer | Seam under test | Harness | Pins |
|---|---|---|---|
| **Unit — BrowserService** | screencast fan-out, input replay, handoff lock | `FakeCdpSession` (no browser) | frame seq/pacing, ack, `Input.dispatch*` mapping, awaitingHuman state machine |
| **Unit — input-mapper** | canvas coords + key events → CDP params | pure fn | DPR/scale math, button/modifier/text mapping |
| **Contract — `browser:*` over gateway** | realtime protocol, real socket.io-client ↔ real gateway | extend `realtime-test-harness` with `withBrowser` (fake CDP) | attach/detach acks, frame envelopes, multiplex, ownership |
| **Unit — ownership/teardown** | per-connection scope | gateway harness | a socket only touches browsers it attached; disconnect kills its sessions |
| **Tool RPC** | LLM tool → server route → service | `fake-pi` + `extension-harness` | navigate/act/snapshot RPC; `request_login` emits correct artifact; `wait_for_human` resolves on /resume |
| **Redaction** | `browser_snapshot` model output | fake CDP returning a DOM w/ password field | password value never present in tool result |
| **Web widget (DOM)** | canvas render + input capture | jsdom + mocked `CanvasRenderingContext2D`/`Image` + `FakeSocket` | draws on `browser:frame`; emits correct `browser:input`; awaitingHuman banner; maximize |
| **Reveal** | Tier-B artifact + (Tier-C) reveal event | client realtime harness | `kind:'html'` artifact url shape; `SessionDashboard` switches view on `activity:reveal` |
| **Golden e2e (real browser)** | the whole loop end-to-end | Playwright + real Chromium via CDP + headless viewer page | drive → frontend frame updates; human input → remote DOM mutates |
| **Resilience** | reconnect/resume, crash, leak | gateway + fake CDP; e2e for crash | resume by seq; browser-crash surfaces `browser:meta{closed}`; no orphan procs |
| **Perf/backpressure** | frame pacing, bounded buffer | fake CDP emitting fast | ack-paced, coalesced moves, byte cap, no unbounded queue |

---

## 2. Harnesses to build

- **`FakeCdpSession`** (the workhorse). Implements `send(method, params)` and
  `on(event, cb)`. Test code calls `emitFrame({data,metadata})` to push a
  synthetic `Page.screencastFrame`, and asserts on captured
  `Input.dispatchMouseEvent/KeyEvent/insertText` + `screencastFrameAck` calls.
  No real browser → deterministic, millisecond-fast.
- **`createRealtimeHarness({ withBrowser })`** — extend the existing
  `tests/helpers/realtime-test-harness.ts` (which already has `withPty`) so a
  `BrowserService` backed by `FakeCdpSession` is mounted on a real gateway. Add
  `socket.browserAttach()`, `waitBrowserFrame()`, `browserInput()` helpers
  paralleling the `ptyOpen/waitPtyData` helpers.
- **Real-browser e2e harness** — `chromium.launchServer({headless})` → CDP
  endpoint → real `BrowserService`; a headless Playwright page loads the viewer
  to act as the user. (This is the throwaway prototype, formalized with asserts.)
- **Widget DOM harness** — jsdom; stub `HTMLCanvasElement.getContext` to a
  recording 2d-context and `Image` to fire `onload` synchronously; `FakeSocket`
  with `emit`/`onmessage`. Reuse `@testing-library/react` (already a pr-story dep).

---

## 3. Acceptance criteria — headline journeys (Given/When/Then)

### A. Watch (sidebar reveal)  🔴
- **Given** an agent browser session exists and is on `example.com`,
- **When** the user opens the Browser sidebar tab,
- **Then** within 1 frame interval the canvas shows `example.com` and
  `browser:meta.url` === the page url; **and** no `browser:frame` was emitted
  before the tab was opened (hidden = no stream).

### B. Drive (LLM → frontend)  🔴
- **Given** the Browser tab is open and attached,
- **When** the LLM calls `browser_navigate('https://playwright.dev')`,
- **Then** the viewer receives ≥1 `browser:frame` with a higher seq and a
  `browser:meta` whose url is `playwright.dev` (assert via seq + meta, not pixels).

### C. Login handoff (the forcing case)  🔴 — primary acceptance test
- **Given** the LLM navigates to a login page and calls
  `browser_request_login('GitHub needs your password')`,
- **Then** the tool result carries
  `details.piRemoteControlArtifact = { kind:'html', url:/\/api\/ext\/browser\/live\// }`
  (Tier-B inline card) **and** `browser:meta.awaitingHuman === true`;
- **When** the user (simulated) sends `browser:input` keystrokes for the password
  and clicks the "Resume" control (`POST …/resume`),
- **Then** the remote page's `#password` field value equals what was typed
  **and** a pending `browser_wait_for_human()` resolves;
- **And** the typed password appears in **zero** tool results / model-visible
  content (assert the captured tool I/O contains neither the secret nor a frame).

### D. Hidden by default  🔴
- **Given** no viewer is attached, **Then** the service issues no
  `Page.startScreencast` and emits no frames; **When** the last viewer detaches,
  **Then** `Page.stopScreencast` is called (no background streaming cost).

### E. Cleanup / no orphans  🔴/🟢
- **When** a viewer socket disconnects, its attached browser sessions are torn
  down (mirror PtyManager); **When** the pi session closes, the Chromium for it
  exits (e2e asserts the child pid is gone).

---

## 4. Invariants that must not regress  🟢

1. **Ownership**: a socket can only `input`/`detach` browsers it attached;
   foreign `browserId` → ack `{ok:false}`, socket stays connected. (copy the
   PTY ownership tests verbatim in spirit.)
2. **No leak**: `onConnection` disposer runs on disconnect; no dangling CDP
   listeners or screencast handlers after N attach/detach cycles.
3. **Frames never enter model context**: only `browser_snapshot` returns
   model-visible page data, and it redacts `input[type=password]`.
4. **REST/SSE/session:* untouched**: `browser:*` shares the gateway without
   shadowing `session:subscribe` or `/api/*` (reuse the gateway-coexistence
   assertions).
5. **Sandboxed inline card still streams**: the Tier-B iframe
   (`sandbox="allow-scripts"`) can open its WebSocket and render frames.

---

## 5. Non-functional budgets (measured, asserted in perf layer)

- **Backpressure**: with a fake CDP emitting frames faster than acks, buffered
  bytes stay below a cap; no unbounded array growth (assert queue length bound).
- **Move coalescing**: a burst of N `mousemove` over the wire collapses to ≤1
  dispatch per frame tick.
- **Latency (e2e, soft gate)**: input→observable DOM change < 300 ms locally.
- **Frame size**: JPEG quality/maxWidth keep median frame under a byte cap.
- **Leak**: 100 navigations → RSS growth under threshold; screencast handler
  count returns to baseline.

---

## 6. The golden e2e in detail (how to assert on a stream deterministically)

Don't pixel-diff (flaky). Prove the loop with **state round-trips**:

1. Launch real Chromium (CDP) → `BrowserService` → start gateway → load the
   viewer page headless (the "user").
2. **Drive**: `page.goto(loginUrl)`; assert the viewer got a frame with seq>prev
   AND `meta.url===loginUrl`. (streaming reflects driving)
3. **Human input**: send the viewer's own `browser:input` messages (mouse click
   on the password field coords, then keydowns for `hunter2!`); read back
   `remotePage.inputValue('#password')` === `'hunter2!'`. (input path works —
   this is exactly what the prototype's `input-test.mjs` proved, now asserted)
4. **Handoff**: `POST /resume`; assert `browser_wait_for_human()` promise resolves.
5. One optional **visual smoke** (separate, allowed-to-be-soft): navigate to a
   page with known text, decode one frame, OCR/region-hash to confirm non-blank.

CI wiring: a `playwright.browser.config.ts` mirroring `playwright.terminal.config.ts`;
unit/contract layers run under vitest in normal CI; the real-browser e2e runs in
the browser-enabled CI job (Xvfb available).

---

## 7. Definition of done (merge gate)

- [ ] All 🔴 layers green; all 🟢 invariants green and added to the regression set.
- [ ] Golden e2e passes headless AND headful (Xvfb).
- [ ] Redaction test proves no secret/frame in model-visible output.
- [ ] Ownership + teardown + reconnect/resume suites green (no orphan Chromium).
- [ ] Perf budgets asserted (backpressure, coalescing, leak).
- [ ] Works on a host WITHOUT `ctx.activity.reveal` (Tier C) — degrades to Tier B.
- [ ] Old host guard: refuses to activate without `ctx.server.realtime` with a
      clear message (copy the terminal ext's guard test).
```
