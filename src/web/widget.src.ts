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
  const wrapRef = useRef(null);
  const kbRef = useRef(null);
  const gestureRef = useRef({ sx: 0, sy: 0, lx: 0, ly: 0, px: 0, py: 0, moved: false, touch: false });
  const pressedRef = useRef(false);
  const sizeRef = useRef({ w: 1280, h: 800 });
  const transportRef = useRef(null);
  const browserIdRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const [url, setUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const editingRef = useRef(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [awaiting, setAwaiting] = useState(null);
  // Auto-maximize on touch devices: a sidebar-sized panel is too small to use
  // a browser on a phone, so fill the screen by default (restore button remains).
  const isCoarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const [maximized, setMaximized] = useState(isCoarse);
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
          const r = await transport!.attach(sessionId, undefined, measureViewport() ?? undefined);
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
  // Keep the remote viewport in sync with the displayed area (maximize, rotate,
  // window resize). Debounced; only when attached.
  useEffect(() => {
    const el = wrapRef.current as any;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let t: any = null;
    const push = () => {
      const id = browserIdRef.current; const t2 = transportRef.current as any; const vp = measureViewport();
      if (id && t2 && vp) t2.resize(id, vp);
    };
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(push, 200); });
    ro.observe(el);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [maximized]);

  // Input targets the live transport+browser via refs (no re-subscription).
  const send = (ev: Record<string, unknown>) => {
    const t = transportRef.current;
    const id = browserIdRef.current;
    if (t && id) t.input(id, ev);
  };

  // Measure the on-screen display area so the remote render matches it (size +
  // mobile layout), instead of shrinking a 1280px desktop page to a strip.
  const measureViewport = () => {
    const el = wrapRef.current as any;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    return {
      width: Math.max(320, Math.round(r.width)),
      height: Math.max(240, Math.round(r.height)),
      mobile: isCoarse || r.width < 700,
      deviceScaleFactor: dpr,
    };
  };

  // Summon the on-screen keyboard by focusing the hidden textarea (mobile can
  // only raise the soft keyboard for a focused editable element).
  const focusKeyboard = () => { try { (kbRef.current as any)?.focus({ preventScroll: true }); } catch { /* ignore */ } };

  // --- Pointer input: mouse = move/click/drag; touch = tap-to-click + drag-to-scroll.
  const onPointerDown = (ev: any) => {
    const p = toPage(ev);
    gestureRef.current = { sx: ev.clientX, sy: ev.clientY, lx: ev.clientX, ly: ev.clientY, px: p.x, py: p.y, moved: false, touch: ev.pointerType !== 'mouse' };
    pressedRef.current = true;
    try { canvasRef.current?.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
    if (ev.pointerType === 'mouse') send({ kind: 'mouse', type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  };
  const onPointerMove = (ev: any) => {
    const g = gestureRef.current;
    if (!pressedRef.current) {
      if (ev.pointerType === 'mouse') { const p = toPage(ev); send({ kind: 'mouse', type: 'mouseMoved', x: p.x, y: p.y }); }
      return;
    }
    if (Math.abs(ev.clientX - g.sx) + Math.abs(ev.clientY - g.sy) > 8) g.moved = true;
    if (ev.pointerType === 'mouse') {
      const p = toPage(ev); send({ kind: 'mouse', type: 'mouseMoved', x: p.x, y: p.y });
    } else {
      // touch drag → scroll the page by the delta since the last move
      const r = canvasRef.current!.getBoundingClientRect();
      const { w, h } = sizeRef.current;
      const dx = (ev.clientX - g.lx) * (w / r.width);
      const dy = (ev.clientY - g.ly) * (h / r.height);
      g.lx = ev.clientX; g.ly = ev.clientY;
      send({ kind: 'mouse', type: 'mouseWheel', x: g.px, y: g.py, deltaX: -dx, deltaY: -dy });
    }
  };
  const onPointerUp = (ev: any) => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    const g = gestureRef.current;
    if (ev.pointerType === 'mouse') {
      const p = toPage(ev); send({ kind: 'mouse', type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      focusKeyboard();
    } else if (!g.moved) {
      // tap → click the remote element, then raise the keyboard. focus() MUST be
      // synchronous within this gesture or iOS won't open the soft keyboard. The
      // canvas is non-focusable + its mousedown is preventDefault'd, so the
      // synthesized mouse events that follow can't blur the textarea.
      send({ kind: 'mouse', type: 'mousePressed', x: g.px, y: g.py, button: 'left', clickCount: 1 });
      send({ kind: 'mouse', type: 'mouseReleased', x: g.px, y: g.py, button: 'left', clickCount: 1 });
      focusKeyboard();
    }
  };

  // --- Soft + hardware keyboard: forwarded from the hidden textarea.
  const onKbKeyDown = (ev: any) => {
    if (ev.key && ev.key.length > 1) { // named keys (Enter, Backspace, Arrow*, Tab, Esc)
      send({ kind: 'key', type: 'keyDown', key: ev.key, code: ev.code });
      if (['Backspace', 'Tab', 'Enter', 'ArrowUp', 'ArrowDown'].includes(ev.key)) ev.preventDefault();
    } else if (ev.key && (ev.ctrlKey || ev.metaKey)) {
      send({ kind: 'key', type: 'keyDown', key: ev.key, code: ev.code, modifiers: { ctrl: ev.ctrlKey, meta: ev.metaKey, shift: ev.shiftKey, alt: ev.altKey } });
    }
  };
  const onKbKeyUp = (ev: any) => { if (ev.key && ev.key.length > 1) send({ kind: 'key', type: 'keyUp', key: ev.key, code: ev.code }); };
  // beforeinput carries soft-keyboard text/IME on mobile (keydown often lacks it).
  const onKbBeforeInput = (ev: any) => {
    const t = ev.inputType;
    if (t === 'insertText' && ev.data) { send({ kind: 'text', text: ev.data }); ev.preventDefault(); }
    else if (t === 'insertLineBreak' || t === 'insertParagraph') { send({ kind: 'key', type: 'keyDown', key: 'Enter' }); send({ kind: 'key', type: 'keyUp', key: 'Enter' }); ev.preventDefault(); }
    else if (t === 'deleteContentBackward') { send({ kind: 'key', type: 'keyDown', key: 'Backspace' }); send({ kind: 'key', type: 'keyUp', key: 'Backspace' }); ev.preventDefault(); }
  };

  const ctrlAction = (action: string) => async () => {
    const id = sessionIdRef.current; if (!id) return;
    try { await fetch(`/api/ext/browser/${encodeURIComponent(id)}/${action}`, { method: 'POST' }); } catch { /* ignore */ }
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
  const btnStyle = { flexShrink: 0, width: 34, height: 34, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#fff', color: '#5f6368', border: '1px solid #dadce0', borderRadius: 8 };
  // Crisp, consistent line icons (no emoji — they render inconsistently per OS).
  const svg = (...children: any[]) => React.createElement('svg', { width: 17, height: 17, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, ...children);
  const P = (d: string) => React.createElement('path', { d });
  const icons: Record<string, any> = {
    back: svg(P('M10 3 L5 8 L10 13')),
    reload: svg(P('M12.5 5.5 A4.5 4.5 0 1 0 13 9'), P('M12.8 2.6 L12.8 5.6 L9.8 5.6')),
    keyboard: svg(React.createElement('rect', { x: 1.5, y: 4, width: 13, height: 8, rx: 1.3 }), P('M6 9.5 L10 9.5')),
    expand: svg(P('M6 2.5H2.5V6'), P('M10 2.5h3.5V6'), P('M6 13.5H2.5V10'), P('M10 13.5h3.5V10')),
    collapse: svg(P('M2.5 6H6V2.5'), P('M13.5 6H10V2.5'), P('M2.5 10H6V13.5'), P('M13.5 10H10V13.5')),
  };
  const rootStyle = maximized
    ? { position: 'fixed', inset: '0', zIndex: 2147483000, display: 'flex', flexDirection: 'column', background: '#15151a' }
    : { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#15151a' };

  return React.createElement('div', { className: 'pi-browser-widget', style: rootStyle, role: 'region', 'aria-label': 'Live remote browser' },
    // Header padded to clear the host's floating corner controls (sidebar
    // toggle on the left, menu on the right) — important on mobile where they
    // overlay the panel. The URL field is a rounded search pill.
    React.createElement('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', paddingLeft: maximized ? 12 : 58, paddingRight: 10, paddingTop: maximized ? 'calc(8px + env(safe-area-inset-top, 0px))' : 8, minHeight: 52, boxSizing: 'border-box', color: '#202124', font: '13px system-ui', borderBottom: '1px solid #dadce0', background: '#f1f3f4' } },
      // Maximize/restore on the LEFT, matching the host's sidebar-toggle side + line-icon style.
      React.createElement('button', { 'aria-label': maximized ? 'Restore' : 'Maximize', title: maximized ? 'Restore' : 'Maximize', onClick: () => setMaximized(!maximized), style: btnStyle }, maximized ? icons.collapse : icons.expand),
      React.createElement('button', { 'aria-label': 'Back', title: 'Back', onClick: ctrlAction('back'), style: btnStyle }, icons.back),
      React.createElement('button', { 'aria-label': 'Reload', title: 'Reload', onClick: ctrlAction('reload'), style: btnStyle }, icons.reload),
      React.createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px', background: '#fff', border: '1px solid #dadce0', borderRadius: 999, boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' } },
        React.createElement('span', { 'data-testid': 'status-dot', title: status, style: { flexShrink: 0, width: 9, height: 9, borderRadius: '50%', background: dot, display: 'inline-block' } }),
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
      React.createElement('button', { 'aria-label': 'Keyboard', title: 'Show keyboard', onClick: focusKeyboard, style: btnStyle }, icons.keyboard),
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
    // Hidden textarea: focusing it raises the mobile soft keyboard; we forward
    // its keystrokes/IME to the remote page (the canvas isn't a real input).
    React.createElement('textarea', {
      ref: kbRef, 'aria-hidden': 'true', autoCapitalize: 'off', autoCorrect: 'off', autoComplete: 'off', spellCheck: false,
      onKeyDown: onKbKeyDown, onKeyUp: onKbKeyUp, onBeforeInput: onKbBeforeInput, onInput: (e: any) => { e.target.value = ''; },
      style: { position: 'absolute', opacity: 0, width: 1, height: 1, padding: 0, border: 0, left: 2, bottom: 2, resize: 'none' },
    }),
    React.createElement('div', { ref: wrapRef, style: { flex: '1 1 auto', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
      React.createElement('canvas', {
        ref: canvasRef, width: 1280, height: 800, 'aria-label': 'Remote browser viewport',
        style: { maxWidth: '100%', maxHeight: '100%', background: '#fff', cursor: 'crosshair', boxShadow: '0 0 0 1px #333', touchAction: 'none' },
        onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerCancel: onPointerUp,
        // Prevent the (synthesized) mousedown from moving focus off the hidden
        // textarea — that was dismissing the soft keyboard right after it opened.
        onMouseDown: (e: any) => e.preventDefault(),
      }),
    ),
  );
}
