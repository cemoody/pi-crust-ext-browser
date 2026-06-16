/**
 * Live-card client (bundled → live-card.js). Loaded by the Tier-B inline-card
 * HTML inside a sandbox="allow-scripts" iframe. Reads { sessionId, token } from
 * window.__PI_BROWSER_CARD__, connects to the SAME-origin gateway with the
 * session-scoped token (SEC-8 / DEPLOY-2), renders frames + forwards input.
 * No React — plain DOM.
 */
import { io } from 'socket.io-client';
import { createGatewayTransport } from './gateway-client.js';
import { gatewaySocketPath, resolveGatewayOrigin } from '../core/transport.js';

const cfg = (window as any).__PI_BROWSER_CARD__ as { sessionId: string; token: string } | undefined;
const canvas = document.getElementById('c') as HTMLCanvasElement | null;
const dot = document.getElementById('dot');
const u = document.getElementById('u');
const doneBtn = document.getElementById('done') as HTMLButtonElement | null;

async function main() {
  if (!cfg || !canvas) return;
  const ctx = canvas.getContext('2d');
  let size = { w: 1280, h: 800 };

  const socket = io(resolveGatewayOrigin(window.location.origin), {
    path: gatewaySocketPath(),
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
  const transport = createGatewayTransport(socket as any);

  transport.onFrame((f) => {
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      if (canvas.width !== f.w) { canvas.width = f.w; canvas.height = f.h; }
      size = { w: f.w, h: f.h };
      ctx.drawImage(img, 0, 0, f.w, f.h);
    };
    img.src = 'data:image/jpeg;base64,' + f.jpegB64;
  });
  transport.onMeta((m) => { if (u && m.url) u.textContent = m.url; });

  let browserId: string | null = null;
  try {
    const r = await transport.attach(cfg.sessionId, cfg.token);
    browserId = r.browserId;
    dot?.classList.add('live');
    if (u) u.textContent = 'live';
  } catch {
    if (u) u.textContent = 'connection failed';
    return;
  }

  // "I'm done — resume": unblock the assistant's browser_wait_for_human.
  doneBtn?.addEventListener('click', () => {
    if (!browserId) return;
    doneBtn.disabled = true;
    doneBtn.textContent = 'resuming\u2026';
    void transport.resume(browserId).then(() => {
      doneBtn.textContent = '\u2713 resumed';
    }).catch(() => {
      doneBtn.disabled = false;
      doneBtn.textContent = '\u2713 I\u2019m done \u2014 resume';
    });
  });

  const toPage = (ev: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.round((ev.clientX - r.left) * (size.w / r.width)), y: Math.round((ev.clientY - r.top) * (size.h / r.height)) };
  };
  const send = (ev: Record<string, unknown>) => { if (browserId) transport.input(browserId, ev); };
  canvas.addEventListener('mousedown', (e) => { const p = toPage(e); send({ kind: 'mouse', type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); canvas.focus(); });
  canvas.addEventListener('mouseup', (e) => { const p = toPage(e); send({ kind: 'mouse', type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); });
  canvas.addEventListener('mousemove', (e) => { const p = toPage(e); send({ kind: 'mouse', type: 'mouseMoved', x: p.x, y: p.y }); });
  canvas.addEventListener('keydown', (e) => { send({ kind: 'key', type: 'keyDown', key: e.key, code: e.code, text: e.key.length === 1 ? e.key : undefined }); e.preventDefault(); });
  canvas.addEventListener('keyup', (e) => { send({ kind: 'key', type: 'keyUp', key: e.key, code: e.code }); e.preventDefault(); });
}

void main();
