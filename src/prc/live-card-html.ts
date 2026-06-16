/**
 * The Tier-B inline-card HTML served by GET /api/ext/browser/live/:sessionId.
 * Self-contained: a canvas + a small script that loads the bundled live-card
 * client (socket.io + gateway attach) with the session-scoped token baked in.
 * Rendered in a sandbox="allow-scripts" iframe (opaque origin) by the host.
 */
export function renderLiveCardHtml(opts: { sessionId: string; token: string; assetUrl: string }): string {
  const cfg = JSON.stringify({ sessionId: opts.sessionId, token: opts.token });
  return [
    '<!doctype html><meta charset=utf8>',
    '<style>html,body{margin:0;height:100%;background:#15151a;font:12px system-ui;color:#ddd}',
    '.bar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #333}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#da3;display:inline-block}',
    '.dot.live{background:#3c6}#u{opacity:.75;font-family:ui-monospace,monospace}',
    '#done{margin-left:auto;border:0;border-radius:6px;background:#3c6;color:#06210f;font:600 12px system-ui;padding:6px 12px;cursor:pointer}',
    '#done:hover{background:#4d7}#done:disabled{background:#2a4;color:#9cb;cursor:default}',
    '.wrap{display:flex;align-items:center;justify-content:center;padding:6px}',
    'canvas{max-width:100%;max-height:460px;background:#fff;cursor:crosshair;box-shadow:0 0 0 1px #333}</style>',
    '<div class=bar><span class=dot id=dot></span><b>\uD83D\uDD10 Sign in</b><span id=u>connecting\u2026</span>',
    '<button id=done title="Tell the assistant you have finished signing in">\u2713 I\u2019m done \u2014 resume</button></div>',
    '<div class=wrap><canvas id=c width=1280 height=800 tabindex=0></canvas></div>',
    `<script>window.__PI_BROWSER_CARD__=${cfg};</script>`,
    `<script type="module" src="${opts.assetUrl}"></script>`,
  ].join('\n');
}
