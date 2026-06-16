# pi-crust-ext-browser — extension plan

Prototype in this dir is throwaway. This is the real design. It reuses two
proven mechanisms from the codebase: the terminal extension's
`ctx.server.realtime` streaming transport, and the pr-story/presentation
`details.piRemoteControlArtifact` tool-result channel.

## 1. Process & ownership model

Two processes already exist and must cooperate:

- **pi-crust server process** — owns the realtime gateway, server routes, and
  the sidebar activities. THIS is where the browser lives.
- **pi agent process** — runs the LLM and its tools.

Decision: **the server process owns the remote browser** (a "BrowserService").
The LLM tool does NOT hold the Playwright handle directly; it drives the browser
by calling server routes (RPC). Rationale: one lifecycle owner, the "reveal"
signal and the human-handoff lock live next to the browser, and the agent
process needs no direct CDP socket. (browserd/Steel both do server-owned.)

```
 LLM tool (agent proc) ──HTTP /api/ext/browser/*──►  BrowserService (server proc)
                                                       │  Playwright + CDP
 user browser  ◄── realtime browser:* (frames/input) ─┤  ─► remote Chromium
                                                       │     (Steel container or
 transcript    ◄── inline html artifact (reveal) ──────┘      launched headful)
```

The "remote box" is just where Chromium runs: a local Steel container, a
launched headful Chromium under Xvfb, or a CDP URL to another machine. The
BrowserService takes a `CDP_URL` / launcher config — swapping local↔remote is a
config change.

## 2. Package layout (one npm package, dual entry — like pr-story)

```
package.json
  pi.extensions      → ./src/pi/index.ts     (LLM tools)
  piCrust.extension  → ./src/prc/server.ts    (routes + realtime + activities)
  piCrust.web        → ./src/web/widget.mjs    (canvas viewer; renderActivity)
src/core/browser-service.ts   screencast + input + session lifecycle (testable)
src/core/protocol.ts          browser:* wire types, input-mapper
```

## 3. Wire protocol (realtime gateway, mirrors pty:*)

```
client → server : browser:attach { sessionId }            → ack { ok, browserId, viewport }
                  browser:input  { browserId, kind, ... }   (mouse/key/text/scroll)
                  browser:detach { browserId }
server → client : browser:frame  { browserId, seq, jpegB64, w, h }
                  browser:meta    { browserId, url, title, awaitingHuman?, reason? }
```

Per-connection ownership exactly like the PTY manager; detach/disconnect stops
the screencast (no cost when hidden). Frames are CDP `Page.startScreencast`
JPEG, paced with `screencastFrameAck`. Input replays via CDP `Input.dispatch*`.

## 4. UX surfaces & the three reveal tiers

The widget is **hidden by default**. Revealing it has three tiers:

### Tier A — Sidebar activity (persistent, user-initiated reveal)  ✅ today
`ctx.activity.registerView({ id:'browser', title:'Browser', icon:'globe' })`.
A normal sidebar tab the user clicks to watch/drive. Unmounts when not active,
so no streaming when hidden. This is the "usually hidden, optionally reveal"
home. Includes maximize-to-overlay (the terminal ext already does
`position:fixed; inset:0; z-index:…`).

### Tier B — Inline live card in the transcript (LLM-forced reveal)  ✅ today
When the LLM needs a human (e.g. a login wall), it calls `browser_request_login`.
The tool returns a result carrying:
```
details.piRemoteControlArtifact = {
  version:1, kind:'html', title:'Sign in required',
  url:'/api/ext/browser/live/<sessionId>?reason=...'
}
```
Core renders this as `<iframe sandbox="allow-scripts" src=url>` INLINE in the
conversation the user is already reading — effectively inserting the live,
interactive browser in front of them. The route serves the same canvas viewer;
its WebSocket (allowed in a sandboxed iframe) streams frames + accepts the
human's clicks/keystrokes. This is the "force the user to look at that tab"
behavior with zero core changes.

### Tier C — Auto-focus / maximize the sidebar panel (small core PR)  ⛳ propose
Today there is no host API to switch the active sidebar view from an extension.
Propose a minimal core addition so the strongest "force" works for the sidebar
too:
- `ctx.activity.reveal(id, { maximize?, flash? })`, backed by a realtime
  `activity:reveal` event that `SessionDashboard` honors by `setView('activity:id')`.
- Optional badge/toast on the sidebar item when `awaitingHuman`.
Until that lands, Tier B (inline card) is the primary forcing mechanism and is
strictly better UX anyway (it's where the user's eyes already are).

## 5. Human-handoff state machine (the login case)

```
LLM: browser_navigate(loginUrl)
LLM: browser_request_login(reason)         ──► emits Tier-B card + sets awaitingHuman=true
                                                 + (Tier C) reveal/flash sidebar
user: clicks into live view, types username/password   (CDP Input.dispatch*)
user: clicks "Done — resume agent"          ──► POST /api/ext/browser/<id>/resume
server: resolves the awaited promise / flips awaitingHuman=false
LLM: browser_wait_for_human() resolves      ──► continues automation, now authed
```

Credentials flow user→canvas→CDP→page. They are NEVER sent to the model:
screencast frames go only to the user's browser, and `browser_snapshot` returns
DOM/aria text with password inputs redacted. The model sees post-login state,
not the secret.

## 6. LLM tool set (pi.extensions)

- `browser_open({ url? })` → ensure session, return { browserId, url, title }.
- `browser_navigate({ url })`, `browser_act({ action, selector?, text? })` →
  click/fill/press/scroll/waitFor via server RPC.
- `browser_snapshot()` → aria/DOM text + a screenshot artifact for the model
  (passwords redacted).
- `browser_request_login({ reason })` → Tier-B reveal + set awaitingHuman.
- `browser_wait_for_human({ timeoutMs })` → resolves on /resume.

## 7. Security / resource notes

- CDP endpoint bound to localhost / session sandbox; never public.
- `browserId` ownership per realtime connection (copy PtyManager semantics).
- Screencast throttled (quality, maxWidth, ack-paced); stops on detach/hide.
- One browser session per pi session; GC on session close (mirror PtyManager
  disposeAll on disconnect).
- Headful needs Xvfb in the server image (present on this box); `headless:'new'`
  fallback also supports screencast+input.

## 8. Build order

1. `BrowserService` (core, unit-tested with a mock CDP) — screencast fan-out +
   input replay + handoff lock. Adapt the throwaway `stream-server.mjs` logic.
2. Server entry: realtime `browser:*` + routes (`/sessions`, `/live/:id`,
   `/:id/resume`) + register the sidebar activity.
3. Web `widget.mjs`: canvas viewer + input capture + awaitingHuman banner +
   maximize. Same `renderActivity` contract as the terminal ext.
4. LLM tools incl. `browser_request_login` emitting the Tier-B artifact.
5. (Optional) core PR for `ctx.activity.reveal` (Tier C).
```
