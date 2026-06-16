/**
 * pi-crust web module: the canvas live-browser viewer (sidebar activity + inline
 * card). Exports `renderActivity(props)` per the host's ExternalWebActivity
 * contract. React is supplied by the host via props.React.
 *
 * Rendering + input capture are the real widget; the TRANSPORT is pluggable.
 * Until the `browser:*` realtime gateway lands (layer 3), it speaks a minimal
 * WebSocket protocol to a stream server:
 *   server → client : { type:'frame', data:<jpegB64>, w, h } | { type:'meta', url }
 *   client → server : { kind:'mouse'|'key', ... }
 * Configure the URL via window.__PI_BROWSER_WS__ (default ws://<host>:4000).
 */
export function renderActivity(props) {
  const React = props.React;
  return React.createElement(BrowserViewer, { hostProps: props });
}
export default renderActivity;

function wsUrl() {
  if (typeof window !== 'undefined' && window.__PI_BROWSER_WS__) return window.__PI_BROWSER_WS__;
  const host = typeof location !== 'undefined' ? location.hostname : '127.0.0.1';
  return `ws://${host}:4000`;
}

function BrowserViewer({ hostProps }) {
  const React = hostProps.React;
  const { useEffect, useRef, useState } = React;
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const sizeRef = useRef({ w: 1280, h: 800 });
  const [status, setStatus] = useState('connecting');
  const [url, setUrl] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;
    ws.onopen = () => setStatus('live');
    ws.onclose = () => setStatus('disconnected');
    ws.onerror = () => setStatus('error');
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'frame') {
        const img = new Image();
        img.onload = () => {
          if (canvas.width !== m.w) { canvas.width = m.w; canvas.height = m.h; }
          sizeRef.current = { w: m.w, h: m.h };
          ctx.drawImage(img, 0, 0, m.w, m.h);
        };
        img.src = 'data:image/jpeg;base64,' + m.data;
      } else if (m.type === 'meta' && m.url) {
        setUrl(m.url);
      }
    };
    return () => { try { ws.close(); } catch { /* ignore */ } };
  }, []);

  const toPage = (ev) => {
    const r = canvasRef.current.getBoundingClientRect();
    const { w, h } = sizeRef.current;
    return { x: Math.round((ev.clientX - r.left) * (w / r.width)), y: Math.round((ev.clientY - r.top) * (h / r.height)) };
  };
  const send = (o) => { const ws = wsRef.current; if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const onMouse = (type, button) => (ev) => {
    const p = toPage(ev);
    send({ kind: 'mouse', type, x: p.x, y: p.y, button: button || 'left', clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0 });
    if (type === 'mousePressed') canvasRef.current.focus();
  };
  const onKey = (type) => (ev) => {
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
