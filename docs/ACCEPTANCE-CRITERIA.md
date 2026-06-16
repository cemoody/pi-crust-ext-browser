# pi-crust-ext-browser — extensive acceptance criteria

Numbered, testable criteria grouped by domain. Each has a stable ID, a priority
(**P0** ship-blocker · **P1** before GA · **P2** nice-to-have), and a tag
(🔴 new surface · 🟢 invariant that must not regress). Phrased so each maps to
≥1 automated test. Layer abbreviations: U=unit(fake CDP), C=contract(gateway),
T=tool-RPC, W=widget-DOM, E=golden-e2e(real browser), R=resilience, P=perf.

---

## A. Browser session lifecycle  (prefix LIFE)

- **LIFE-1** P0 🔴 (U/T) Creating a session for a pi sessionId returns a stable
  `browserId`; a second `browser_open` for the same pi session **reuses** it
  (no second Chromium).
- **LIFE-2** P0 🔴 (E) The browser's working dir / profile is scoped to the pi
  session; it cannot read files outside the session sandbox.
- **LIFE-3** P0 🟢 (R/E) Closing the pi session disposes its browser; the child
  Chromium pid is gone within a grace window (no orphans).
- **LIFE-4** P0 🟢 (C) Disconnecting the last viewer socket does **not** kill the
  browser if the LLM still holds it; killing the browser is tied to the pi
  session / explicit close, not viewer presence.
- **LIFE-5** P1 🔴 (R) An idle session (no LLM activity AND no viewer) for N
  minutes is auto-paused/closed; a subsequent `browser_open` transparently
  re-creates it.
- **LIFE-6** P1 🔴 (R/E) If Chromium crashes, the next tool call returns a
  typed `BROWSER_CRASHED` error and a fresh browser is launched on retry; any
  attached viewer receives `browser:meta { closed:true, reason }`.
- **LIFE-7** P1 🔴 (R) Server restart with a live pi session: viewers reconnect
  and re-attach; either the browser is re-attached or a clear "session ended"
  state is shown (no silent black canvas).
- **LIFE-8** P2 🔴 (T) `browser_open` is idempotent under concurrent calls (two
  in-flight opens yield one browser, both get the same id).
- **LIFE-9** P0 🔴 (U) Max-sessions limit enforced; exceeding it returns
  `TOO_MANY_SESSIONS`, never a half-created session.

## B. Streaming / screencast  (prefix STR)

- **STR-1** P0 🔴 (C) On viewer `browser:attach`, the service calls
  `Page.startScreencast` exactly once and the viewer begins receiving frames.
- **STR-2** P0 🔴 (D-test) With **no** viewer attached, `Page.startScreencast` is
  never called and zero frames are emitted (hidden ⇒ no streaming cost).
- **STR-3** P0 🔴 (C) On last viewer `browser:detach`/disconnect,
  `Page.stopScreencast` is called.
- **STR-4** P0 🔴 (C) `browser:frame` envelopes carry a strictly monotonic `seq`
  per browserId; no gaps under normal flow.
- **STR-5** P0 🔴 (C/E) After a navigation, a fresh frame reflecting the new page
  is delivered, and a `browser:meta { url, title }` precedes/accompanies it.
- **STR-6** P0 🔴 (U) Every received `Page.screencastFrame` is acked via
  `Page.screencastFrameAck` (frames keep flowing; no stall after the first).
- **STR-7** P1 🔴 (C/E) Resizing the viewer sends `browser:resize`; the service
  applies device metrics and subsequent frames match the new dimensions.
- **STR-8** P1 🔴 (U) Frame metadata (`deviceWidth/Height`, `offsetTop`,
  `pageScaleFactor`) is propagated so the client can map coordinates exactly.
- **STR-9** P1 🔴 (E) Tab/target switch (page opens a new tab): the service can
  enumerate targets and stream the active one; `browser:meta` reflects which.
- **STR-10** P1 🔴 (W) During load, the viewer shows a loading indicator, not a
  frozen/blank canvas; first painted frame clears it.
- **STR-11** P2 🔴 (R) A slow/stalled viewer never blocks other viewers or the
  LLM (per-viewer send queue, dropped frames coalesce to latest).
- **STR-12** P2 🔴 (U) Frame format/quality configurable (jpeg quality, maxWidth)
  via config; defaults keep median frame under the byte cap (see PERF-4).

## C. Input forwarding  (prefix INP)

- **INP-1** P0 🔴 (U) Mouse move/press/release map to
  `Input.dispatchMouseEvent` with correct type/x/y/button/clickCount.
- **INP-2** P0 🔴 (E) A click in the viewer at canvas coords lands on the correct
  element in the remote page (verified by a DOM side effect).
- **INP-3** P0 🔴 (U) Coordinate mapping is correct under canvas scaling AND
  letterboxing (CSS size ≠ device size, devicePixelRatio ≠ 1, centered with
  margins). Pure-fn table test across several viewport/box combos.
- **INP-4** P0 🔴 (E) Keyboard: typing ASCII into a focused input yields the
  exact string in the remote DOM (the `hunter2!` round-trip).
- **INP-5** P0 🔴 (U) Modifier keys (Shift/Ctrl/Alt/Meta) set CDP `modifiers`
  bitmask; `Shift`+letter produces uppercase.
- **INP-6** P1 🔴 (U) Special keys (Enter, Tab, Backspace, Arrows, Esc) send the
  correct `key`/`code`/`windowsVirtualKeyCode`, not text.
- **INP-7** P1 🔴 (E) Double-click and right-click produce `clickCount:2` and
  `button:'right'` and the expected page behavior (context menu suppressed/handled).
- **INP-8** P1 🔴 (E) Wheel scroll moves the page (`deltaX/Y` via mouseWheel).
- **INP-9** P1 🔴 (E) Click-drag (press, move, release) performs a drag/selection.
- **INP-10** P1 🔴 (W) Clicking the canvas focuses it so keystrokes are captured;
  blur stops capture.
- **INP-11** P2 🔴 (U) `Input.insertText` path used for IME/compound input and
  pasted text; clipboard paste into a field works.
- **INP-12** P2 🔴 (W/E) Mobile: touch events and an on-screen keyboard path work
  on a mobile viewport.
- **INP-13** P0 🟢 (U) Malformed/oversized input messages are rejected without
  crashing the service or dispatching anything.

## D. Human handoff / login flow  (prefix HOFF)

- **HOFF-1** P0 🔴 (T) `browser_request_login(reason)` sets the session
  `awaitingHuman=true` and emits `browser:meta { awaitingHuman:true, reason }`.
- **HOFF-2** P0 🔴 (T) The same tool result carries
  `details.piRemoteControlArtifact = { kind:'html', title, url:/\/api\/ext\/browser\/live\// }`
  (Tier-B inline card).
- **HOFF-3** P0 🔴 (T/E) A pending `browser_wait_for_human()` resolves after the
  user hits Resume (`POST …/resume`); resolves with `{ resumed:true }`.
- **HOFF-4** P0 🔴 (T) `browser_wait_for_human({timeoutMs})` rejects with
  `HUMAN_TIMEOUT` if Resume never comes; awaitingHuman is cleared.
- **HOFF-5** P1 🔴 (T) User can **cancel** the handoff (not just resume),
  rejecting the wait with `HUMAN_CANCELLED`; the LLM gets a typed error.
- **HOFF-6** P1 🔴 (W) The widget shows an unmistakable "Agent is waiting — please
  sign in" banner with Resume + Cancel while awaitingHuman.
- **HOFF-7** P1 🔴 (U) Driver lock: while awaitingHuman, LLM `browser_act`/
  `navigate` calls are queued or rejected with `AWAITING_HUMAN` (no fighting the
  user for the page). Configurable: reject vs. queue.
- **HOFF-8** P1 🔴 (T) Resume when not awaiting is a no-op `{ resumed:false }`
  (idempotent), not an error.
- **HOFF-9** P2 🔴 (T) Multiple sequential `request_login` calls coalesce to one
  awaiting state; Resume clears all pending waits.
- **HOFF-10** P0 🟢 (T) **No credential leakage**: after a full handoff where the
  user types a password, the captured tool I/O and model-visible content contain
  neither the password text nor any frame bytes.

## E. Reveal UX  (prefix RVL)

- **RVL-1** P0 🔴 (W) The Browser sidebar activity registers and is **not** the
  default view (hidden until clicked).
- **RVL-2** P0 🔴 (W) Clicking the sidebar tab attaches and streams; clicking away
  detaches and stops streaming (ties to STR-2/STR-3).
- **RVL-3** P0 🔴 (E) Tier-B inline card renders the live view inside a
  `sandbox="allow-scripts"` iframe in the transcript and successfully opens its
  WebSocket (sandbox does not block streaming).
- **RVL-4** P1 🔴 (W) The inline card is interactive: clicks/keys inside it reach
  the remote page (same input path as the sidebar).
- **RVL-5** P1 🔴 (E) Two surfaces at once (sidebar + inline card) show the same
  session consistently; both can drive (subject to one driver lock at a time).
- **RVL-6** P1 🔴 (W) Maximize/restore: the panel expands to a full-viewport
  overlay and back; Esc restores; canvas refits.
- **RVL-7** P2 🔴 (Tier-C, client harness) When the host supports
  `activity.reveal`, `browser_request_login` switches the active sidebar view to
  Browser and optionally flashes/badges it.
- **RVL-8** P0 🟢 (W) On a host WITHOUT Tier-C reveal, everything still works via
  Tier-B (graceful degradation; no thrown errors, no dead buttons).
- **RVL-9** P2 🔴 (W) Dismissing/closing the card detaches that viewer without
  affecting the session or other viewers.

## F. LLM tools  (prefix TOOL)

- **TOOL-1** P0 🔴 (T) Each tool validates params (typebox); bad input → a clear
  validation error, no partial side effects.
- **TOOL-2** P0 🔴 (T) `browser_navigate` returns `{ url, title, status }`;
  invalid URL → typed `NAV_INVALID_URL`; nav timeout → `NAV_TIMEOUT`.
- **TOOL-3** P0 🔴 (T) `browser_act({action,selector,...})` supports
  click/fill/press/hover/scroll/waitFor; missing selector → `SELECTOR_NOT_FOUND`
  with the selector echoed.
- **TOOL-4** P0 🔴 (T) `browser_snapshot()` returns aria/DOM text (+ optional
  screenshot artifact) sufficient for the model to choose the next action.
- **TOOL-5** P0 🟢 (T) `browser_snapshot()` **redacts** `input[type=password]`
  values (and configurable selectors) — never returns the secret.
- **TOOL-6** P1 🔴 (T) Tools are RPC to the server-owned browser; the agent
  process holds no CDP socket (assert no direct CDP connection from the tool).
- **TOOL-7** P1 🔴 (T) Tool errors are typed and actionable (code + message), not
  raw stack traces leaked to the model.
- **TOOL-8** P2 🔴 (T) Concurrent tool calls on one session are serialized (a
  command queue) so actions don't interleave mid-navigation.

## G. Security & privacy  (prefix SEC)

- **SEC-1** P0 🟢 (C) Per-connection ownership: a socket may only `input`/`detach`
  a `browserId` it attached; foreign ids → `{ok:false}`, socket stays up.
- **SEC-2** P0 🟢 (E) CDP/debugging endpoint binds to localhost / session scope;
  not reachable from outside the host.
- **SEC-3** P0 🟢 (T) Frames are delivered only to the user's browser, never
  included in any tool result or model context (ties HOFF-10, TOOL-5).
- **SEC-4** P1 🔴 (E) Downloads triggered in the live browser land in the session
  sandbox, not arbitrary host paths.
- **SEC-5** P1 🔴 (E) File uploads via the live view are restricted to
  user-selected files within the session (no arbitrary host FS exposure to the page).
- **SEC-6** P1 🟢 (C) Cross-session isolation: viewer of pi-session A cannot
  attach to / receive frames for pi-session B's browser.
- **SEC-7** P2 🔴 (E) Optional: secrets the user types are not persisted to disk
  logs; request/response logging redacts form fields.
- **SEC-8** P1 🟢 (U) The inline-card route requires a valid session token; an
  unauthenticated or wrong-session token is rejected.

## H. Multi-client / concurrency  (prefix MUX)

- **MUX-1** P0 🔴 (C) Multiple viewers of the SAME session each receive frames;
  one physical gateway connection multiplexes them (no per-viewer socket storm).
- **MUX-2** P0 🟢 (C) Zero cross-talk: frames/input for session A never reach a
  viewer attached only to session B (copy the PTY multiplex test).
- **MUX-3** P1 🔴 (C) Two viewers can watch; a single **driver lock** governs who
  may send input at a time; lock handoff is explicit and observable.
- **MUX-4** P1 🔴 (R) Late joiner gets the latest frame immediately (cached last
  frame) rather than waiting for the next paint.

## I. Resilience  (prefix RES)

- **RES-1** P0 🔴 (R) Viewer transport drop + reconnect resumes the stream;
  no duplicate-delivery of already-acked content; meta re-synced.
- **RES-2** P1 🔴 (R) Mid-navigation disconnect: on reconnect the viewer shows
  the current page, not a stale frame.
- **RES-3** P1 🔴 (R/E) Page crash (`Target.crashed`) surfaces
  `browser:meta{closed,reason}` and a recover/reload affordance.
- **RES-4** P1 🔴 (R) Network blip during `browser_navigate` → typed retryable
  error; a retry succeeds.
- **RES-5** P2 🔴 (R) Backpressure under a wedged viewer: the service drops to
  latest-frame-only for that viewer and never grows an unbounded queue.

## J. Performance / backpressure  (prefix PERF)

- **PERF-1** P0 🔴 (P) With a fake CDP emitting frames faster than acks, buffered
  bytes stay below a hard cap; queue length is bounded.
- **PERF-2** P1 🔴 (P/W) A burst of mousemove collapses to ≤1 dispatch per frame
  tick (client coalescing) — assert dispatch count.
- **PERF-3** P1 🔴 (E, soft) Input→observable DOM change < 300 ms locally.
- **PERF-4** P1 🔴 (P) Median JPEG frame under the configured byte cap at default
  quality/maxWidth.
- **PERF-5** P1 🟢 (R) 100 navigations + 50 attach/detach cycles: RSS growth under
  threshold and screencast/listener counts return to baseline (leak guard).
- **PERF-6** P2 🔴 (P) Idle (no input, static page) settles to ≤1 fps / near-zero
  CPU (no busy frame loop).

## K. Errors & edge cases  (prefix ERR)

- **ERR-1** P0 🔴 (C) `browser:attach` for unknown pi session → `{ok:false,error}`,
  socket stays connected.
- **ERR-2** P0 🔴 (C) Double `attach` for the same session on one socket is
  idempotent (same browserId, one stream).
- **ERR-3** P1 🔴 (C) Oversized/malformed `browser:*` payloads are rejected; the
  gateway and other sessions are unaffected.
- **ERR-4** P1 🔴 (T) `act`/`navigate` after the browser closed → typed
  `BROWSER_CLOSED`, not a hang.
- **ERR-5** P2 🔴 (W) Canvas receives a corrupt/garbage frame → it's skipped, no
  exception, stream continues.

## L. Host compatibility & install  (prefix HOST)

- **HOST-1** P0 🟢 (U) Without `ctx.server.realtime`, activation throws a clear,
  actionable error (copy the terminal ext guard + its test).
- **HOST-2** P1 🔴 (W) Missing sidebar icon glyph falls back to the generic
  extension icon (forward-compatible).
- **HOST-3** P1 🔴 (E) Install via Settings without server restart (≥0.3.0 hosts);
  uninstall removes the activity and tears down sessions cleanly.
- **HOST-4** P1 🟢 (T) The pi-side tools register independently of the pi-crust
  web side; a host that loads only one half still works for that half.

## M. Observability  (prefix OBS)

- **OBS-1** P1 🔴 (E) `/health`/readiness reflects browser availability; not-ready
  when Chromium failed to launch.
- **OBS-2** P2 🔴 Structured logs for session create/close, attach/detach,
  handoff, crashes — with form fields redacted (ties SEC-7).
- **OBS-3** P2 🔴 Basic metrics: active sessions, viewers, fps, frame bytes,
  dropped frames — exposed for debugging.

## N. Accessibility & mobile  (prefix A11Y)

- **A11Y-1** P1 🔴 (W) The activity/region has proper ARIA labels and the canvas
  is keyboard-focusable with a visible focus ring.
- **A11Y-2** P1 🔴 (W) Resume/Cancel handoff controls are reachable by keyboard
  and announced by screen readers.
- **A11Y-3** P2 🔴 (W/E) Mobile viewport: pinch/scroll, on-screen keyboard, and
  fullscreen all function (ties INP-12).

---

---

# Phase 2 — make it real (transport + wiring)

The Phase-1 criteria above are covered by the `BrowserService` core (tested vs a
FakeCdpSession). Phase 2 adds the seams that connect that tested brain to a real
browser, the real gateway, and real deployments. These are the criteria the
prototype demo glossed over.

## O. CDP adapter  (prefix CDP) — real browser seam

- **CDP-1** P0 🔴 (U vs FakeRawCdp) The Playwright `CDPSession` adapter satisfies
  `CdpSession`: `send` forwards to the active target; target events reach `on()`.
- **CDP-2** P0 🔴 (U vs FakeRawCdp) **Active-target follow**: when the page does a
  cross-document navigation or a new tab becomes active, the adapter re-binds
  the screencast to the new target and frames follow (old target stops). *This is
  the exact defect the prototype stream-server had.*
- **CDP-3** P1 🔴 (E) Real `Page.frameNavigated` → `browser:meta {url,title}`.
- **CDP-4** P0 🔴 (E) `createPlaywrightCdpFactory` connects to a configured
  `CDP_URL` **or** launches a headful Chromium (Xvfb); readiness reported.
- **CDP-5** P1 🔴 (E) Chromium crash surfaces via the factory; retry relaunches
  (ties LIFE-6).

## P. Gateway wiring  (prefix GW) — browser:* on the shared Socket.IO gateway

- **GW-1** P0 🔴 (C vs FakeRealtimeConnection) `onConnection` handler wires
  `browser:attach/input/detach`; **viewerId === connection id**, so a valid
  attach acks `{ok, browserId}` and frames flow to that socket only.
- **GW-2** P0 🟢 (C) The disconnect disposer detaches every browser the socket
  attached and stops the screencast (no leaks) — mirrors the PTY teardown test.
- **GW-3** P0 🔴 (C) `browser:attach` resolves the pi sessionId via
  `prc.sessions.get`; unknown session **and** bad/missing token are rejected via
  ack (socket stays connected). Enforces SEC-6 + SEC-8 at the wire.
- **GW-4** P1 🔴 (C/E) Live-view route `GET /api/ext/browser/live/:sessionId`
  serves the viewer only with a valid session-scoped token; `:id/resume` resolves
  a pending `wait_for_human` (ties HOFF-3).

## Q. Deployment / origin  (prefix DEPLOY) — the localhost gap

- **DEPLOY-1** P0 🔴 (U + E) The widget connects to the **same origin** the page
  loaded from via `/socket.io/` — no hardcoded host/port. Verified by the URL
  helpers (unit) and by serving pi-crust behind a non-localhost reverse proxy (e2e).
- **DEPLOY-2** P0 🔴 (U + E) The **sandboxed inline card** (`allow-scripts`,
  opaque origin) authenticates to the gateway/route with its **session-scoped
  token** (SEC-8) and streams; missing/forged tokens are rejected. The prototype
  dodged this with an open WebSocket on a fixed port.

### New harnesses for Phase 2
- `FakeRawCdp` / `FakeRawCdpSource` — drive CDP-1/2/3 with target switching, no browser.
- `FakeRealtimeConnection` — run the GW handler against the real `BrowserService`
  (FakeCdpFactory behind it) with no Socket.IO server.
- `createRealtimeHarness({ withBrowser })` (extend core's harness) + a real-browser
  harness — for the e2e-tagged CDP/GW/DEPLOY items.

### Phase-2 must-fix-before-trust (the demo's real gaps)
`CDP-2` (navigation follow), `DEPLOY-1` (same-origin), `DEPLOY-2/SEC-8`
(sandboxed-card auth).

---

## Coverage matrix (must be filled before GA)

Every P0 must have ≥1 automated test in its layer and be in the regression set.
Every 🟢 invariant gets a dedicated guard test. The golden e2e (E) must pass
headless AND headful (Xvfb). Track each ID → test file in a checklist so
coverage gaps are visible at review time.
```
