/**
 * pi-crust web module SOURCE (bundled by scripts/build-web.mjs → widget.mjs).
 *
 * The canvas live-browser viewer for the sidebar activity. Streams over the
 * SHARED Socket.IO gateway (browser:* on the same origin the page loaded from —
 * DEPLOY-1), not a hardcoded WebSocket. React is provided by the host via
 * props.React; socket.io-client is inlined by the bundle.
 */
import { io } from 'socket.io-client';
import { createGatewayTransport } from './gateway-client.js';
import { gatewaySocketPath, resolveGatewayOrigin } from '../core/transport.js';

export function renderActivity(props: any) {
  const React = props.React;
  return React.createElement(BrowserViewer, { hostProps: props });
}
export default renderActivity;

async function resolveSessionId(api: any): Promise<string | null> {
  // Prefer the session in the page URL (?session=…) so the panel matches the
  // session the user is viewing.
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('session');
    if (fromUrl) return fromUrl;
  } catch { /* fall through */ }
  try {
    if (typeof api?.getActiveSessionId === 'function') {
      const id = await api.getActiveSessionId();
      if (id) return id;
    }
  } catch { /* fall through */ }
  try {
    const cwd = typeof api?.getDefaultCwd === 'function' ? await api.getDefaultCwd() : undefined;
    let sessions = await api.listSessions(cwd);
    if (!(Array.isArray(sessions) && sessions.length > 0)) sessions = await api.listSessions();
    if (Array.isArray(sessions) && sessions.length > 0) return sessions[0].id;
  } catch { /* fall through */ }
  return null;
}

function BrowserViewer({ hostProps }: { hostProps: any }) {
  const React = hostProps.React;
  const { useEffect, useRef, useState } = React;
  const canvasRef = useRef(null);
  const sizeRef = useRef({ w: 1280, h: 800 });
  const transportRef = useRef(null);
  const browserIdRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const [url, setUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const editingRef = useRef(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [awaiting, setAwaiting] = useState(null);
  const [maximized, setMaximized] = useState(false);
  const sessionIdRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let transport: ReturnType<typeof createGatewayTransport> | null = null;
    let browserId: string | null = null;

    (async () => {
      const sessionId = await resolveSessionId(hostProps.api);
      if (!sessionId || disposed) { setStatus('no-session'); return; }
      sessionIdRef.current = sessionId;
      // Same-origin gateway connection (DEPLOY-1). The sidebar is the trusted
      // host page, so it attaches WITHOUT a token; only the opaque-origin inline
      // card carries a server-issued token.
      const socket = io(resolveGatewayOrigin(window.location.origin), {
        path: gatewaySocketPath(),
        transports: ['websocket', 'polling'],
        reconnection: true,
      });
      transport = createGatewayTransport(socket as any);
      transportRef.current = transport;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d') ?? null;

      // RES-1: re-attach on every (re)connection so the stream survives socket.io
      // reconnects (each reconnect is a fresh server-side connection).
      const doAttach = async () => {
        try {
          const r = await transport!.attach(sessionId);
          if (disposed) { transport!.detach(r.browserId); return; }
          browserId = r.browserId;
          browserIdRef.current = r.browserId;
          setStatus('live');
          setErrorMsg('');
        } catch (e: any) {
          if (!disposed) { setStatus('error'); setErrorMsg(String(e?.message ?? e)); }
        }
      };
      (socket as any).on?.('connect', doAttach);
      (socket as any).on?.('connect_error', (e: any) => { if (!disposed) { setStatus('error'); setErrorMsg('gateway connect failed: ' + String(e?.message ?? e)); } });

      transport.onFrame((f) => {
        if (!canvas || !ctx) return;
        const img = new Image();
        img.onload = () => {
          if (canvas.width !== f.w) { canvas.width = f.w; canvas.height = f.h; }
          sizeRef.current = { w: f.w, h: f.h };
          ctx.drawImage(img, 0, 0, f.w, f.h);
        };
        img.src = 'data:image/jpeg;base64,' + f.jpegB64;
      });
      transport.onMeta((m) => {
        if (m.url) { setUrl(m.url); if (!editingRef.current) setUrlInput(m.url); }
        if (m.awaitingHuman) setAwaiting({ reason: m.reason || 'Sign in to continue' });
        else if (m.awaitingHuman === false) setAwaiting(null);
        if (m.closed) setStatus('closed');
      });

      // socket.io fires 'connect' on the initial connection too; if it already
      // connected before we subscribed, attach now.
      if ((socket as any).connected) await doAttach();
    })();

    return () => {
      disposed = true;
      if (transport && browserId) transport.detach(browserId);
      transport?.dispose();
    };
  }, []);

  const toPage = (ev: any) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const { w, h } = sizeRef.current;
    return { x: Math.round((ev.clientX - r.left) * (w / r.width)), y: Math.round((ev.clientY - r.top) * (h / r.height)) };
  };
  // Input targets the live transport+browser via refs (no re-subscription).
  const send = (ev: Record<string, unknown>) => {
    const t = transportRef.current;
    const id = browserIdRef.current;
    if (t && id) t.input(id, ev);
  };

  const onMouse = (type: string) => (ev: any) => {
    const p = toPage(ev);
    send({ kind: 'mouse', type, x: p.x, y: p.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
    if (type === 'mousePressed') canvasRef.current?.focus();
  };
  const onKey = (type: string) => (ev: any) => {
    send({ kind: 'key', type, key: ev.key, code: ev.code, text: ev.key.length === 1 ? ev.key : undefined });
    ev.preventDefault();
  };

  // Address bar: navigate the browser THIS widget is attached to.
  const navigateTo = async (raw: string) => {
    const id = sessionIdRef.current;
    if (!id) return;
    let target = (raw || '').trim();
    if (!target) return;
    if (!/^[a-z]+:\/\//i.test(target)) target = 'https://' + target;
    try { await fetch(`/api/ext/browser/${encodeURIComponent(id)}/navigate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: target }) }); } catch { /* ignore */ }
  };

  // HOFF-6: clicking Resume tells the server the human is done signing in.
  const resume = async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    try { await fetch(`/api/ext/browser/${encodeURIComponent(id)}/resume`, { method: 'POST' }); } catch { /* ignore */ }
    setAwaiting(null);
  };

  const dot = status === 'live' ? '#3c6' : status === 'connecting' ? '#da3' : status === 'closed' ? '#e44' : '#e44';
  const rootStyle = maximized
    ? { position: 'fixed', inset: '0', zIndex: 2147483000, display: 'flex', flexDirection: 'column', background: '#15151a' }
    : { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#15151a' };

  return React.createElement('div', { className: 'pi-browser-widget', style: rootStyle, role: 'region', 'aria-label': 'Live remote browser' },
    // Header padded to clear the host's floating corner controls (sidebar
    // toggle on the left, menu on the right) — important on mobile where they
    // overlay the panel. The URL field is a rounded search pill.
    React.createElement('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', paddingLeft: 60, paddingRight: 52, minHeight: 52, boxSizing: 'border-box', color: '#202124', font: '13px system-ui', borderBottom: '1px solid #dadce0', background: '#f1f3f4' } },
      React.createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px', background: '#fff', border: '1px solid #dadce0', borderRadius: 999, boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' } },
        React.createElement('span', { 'data-testid': 'status-dot', title: status, style: { flexShrink: 0, width: 9, height: 9, borderRadius: '50%', background: dot, display: 'inline-block' } }),
        React.createElement('span', { 'aria-hidden': 'true', style: { flexShrink: 0, opacity: 0.55, fontSize: 13 } }, '🔍'),
        React.createElement('input', {
          'data-testid': 'url', value: urlInput, inputMode: 'url', autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false,
          placeholder: status === 'live' ? 'Search or enter address' : status,
          onChange: (e: any) => { editingRef.current = true; setUrlInput(e.target.value); },
          onFocus: (e: any) => { editingRef.current = true; e.target.select(); },
          onBlur: () => { editingRef.current = false; },
          onKeyDown: (e: any) => { if (e.key === 'Enter') { editingRef.current = false; void navigateTo(urlInput); e.target.blur(); } e.stopPropagation(); },
          style: { flex: 1, minWidth: 0, background: 'transparent', color: '#202124', border: 'none', padding: 0, font: '14px system-ui', outline: 'none' },
        }),
      ),
      React.createElement('button', { 'aria-label': maximized ? 'Restore' : 'Maximize', onClick: () => setMaximized(!maximized), style: { flexShrink: 0, width: 36, height: 36, cursor: 'pointer', background: '#fff', color: '#5f6368', border: '1px solid #dadce0', borderRadius: 8, fontSize: 14 } }, maximized ? '🗗' : '🗖'),
    ),
    awaiting ? React.createElement('div', { 'data-testid': 'awaiting-banner', role: 'alert', style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: '#3a2f00', color: '#ffd', font: '12px system-ui' } },
      React.createElement('span', null, `🔐 Agent is waiting — ${(awaiting as any).reason}`),
      React.createElement('button', { onClick: resume, style: { cursor: 'pointer' } }, 'Done — resume'),
    ) : null,
    status === 'error' ? React.createElement('div', { 'data-testid': 'error-banner', role: 'alert', style: { flex: '0 0 auto', padding: '10px 12px', background: '#3a0000', color: '#fdd', font: '12px system-ui', lineHeight: 1.5 } },
      React.createElement('div', { style: { fontWeight: 600 } }, '⚠️ Could not start the browser'),
      errorMsg ? React.createElement('div', { style: { opacity: 0.85, fontFamily: 'ui-monospace, monospace', marginTop: 4, whiteSpace: 'pre-wrap' } }, errorMsg) : null,
      React.createElement('div', { style: { opacity: 0.75, marginTop: 6 } }, 'Set PI_CRUST_BROWSER_CDP_URL to a Chrome debug endpoint (e.g. ws://127.0.0.1:9222/), or run `npx playwright install chromium` on the host, then restart pi-crust.'),
    ) : null,
    React.createElement('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
      React.createElement('canvas', {
        ref: canvasRef, width: 1280, height: 800, tabIndex: 0, 'aria-label': 'Remote browser viewport',
        style: { maxWidth: '100%', maxHeight: '100%', background: '#fff', cursor: 'crosshair', boxShadow: '0 0 0 1px #333' },
        onMouseDown: onMouse('mousePressed'), onMouseUp: onMouse('mouseReleased'), onMouseMove: onMouse('mouseMoved'),
        onKeyDown: onKey('keyDown'), onKeyUp: onKey('keyUp'),
      }),
    ),
  );
}
