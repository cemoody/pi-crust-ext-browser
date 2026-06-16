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

// Fetch a short-lived, session-scoped live-view token from the extension route.
async function fetchToken(sessionId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`/api/ext/browser/token?sessionId=${encodeURIComponent(sessionId)}`, { method: 'POST' });
    if (!res.ok) return undefined;
    const data = await res.json();
    return typeof data?.token === 'string' ? data.token : undefined;
  } catch {
    return undefined;
  }
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

  useEffect(() => {
    let disposed = false;
    let transport: ReturnType<typeof createGatewayTransport> | null = null;
    let browserId: string | null = null;

    (async () => {
      const sessionId = await resolveSessionId(hostProps.api);
      if (!sessionId || disposed) { setStatus('no-session'); return; }
      const token = await fetchToken(sessionId);
      // Same-origin gateway connection (DEPLOY-1).
      const socket = io(resolveGatewayOrigin(window.location.origin), {
        path: gatewaySocketPath(),
        transports: ['websocket', 'polling'],
        reconnection: true,
      });
      transport = createGatewayTransport(socket as any);
      transportRef.current = transport;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d') ?? null;

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
      transport.onMeta((m) => { if (m.url) setUrl(m.url); });

      try {
        const r = await transport.attach(sessionId, token);
        if (disposed) { transport.detach(r.browserId); transport.dispose(); return; }
        browserId = r.browserId;
        browserIdRef.current = r.browserId;
        setStatus('live');
      } catch (e) {
        if (!disposed) setStatus('error');
      }
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

  const dot = status === 'live' ? '#3c6' : status === 'connecting' ? '#da3' : '#e44';
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#15151a' } },
    React.createElement('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', color: '#ddd', font: '12px system-ui', borderBottom: '1px solid #333' } },
      React.createElement('span', { style: { width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block' } }),
      React.createElement('b', null, '🌐 Browser'),
      React.createElement('span', { style: { opacity: 0.7, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, url || status),
    ),
    React.createElement('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
      React.createElement('canvas', {
        ref: canvasRef, width: 1280, height: 800, tabIndex: 0,
        style: { maxWidth: '100%', maxHeight: '100%', background: '#fff', cursor: 'crosshair', boxShadow: '0 0 0 1px #333' },
        onMouseDown: onMouse('mousePressed'), onMouseUp: onMouse('mouseReleased'), onMouseMove: onMouse('mouseMoved'),
        onKeyDown: onKey('keyDown'), onKeyUp: onKey('keyUp'),
      }),
    ),
  );
}
