/**
 * Widget transport over the shared Socket.IO gateway (W-GW). Pure logic behind
 * a minimal socket interface so it's unit-testable with a fake socket — no real
 * socket.io needed. widget.src.ts injects a real socket.io-client `Socket`.
 */
import type { FrameEnvelope, MetaEnvelope } from '../core/protocol.js';
import { createInputCoalescer } from '../core/pacing.js';

/** The subset of a socket.io-client Socket we use. */
export interface GatewaySocket {
  on(event: string, handler: (payload: any) => void): void;
  emit(event: string, payload: any, ack?: (response: any) => void): void;
  disconnect(): void;
}

export interface AttachResult {
  browserId: string;
  viewport?: { width: number; height: number };
}

export interface Viewport { width: number; height: number; mobile?: boolean; deviceScaleFactor?: number }

export interface BrowserGatewayTransport {
  attach(sessionId: string, token?: string, viewport?: Viewport): Promise<AttachResult>;
  input(browserId: string, event: Record<string, unknown>): void;
  resize(browserId: string, viewport: Viewport): void;
  /** Tell the server this client has drawn the current frame (adaptive pacing). */
  frameDone(browserId: string): void;
  detach(browserId: string): void;
  onFrame(cb: (f: FrameEnvelope) => void): () => void;
  onMeta(cb: (m: MetaEnvelope) => void): () => void;
  dispose(): void;
}

export function createGatewayTransport(socket: GatewaySocket, opts?: { ackTimeoutMs?: number; coalesceInput?: boolean }): BrowserGatewayTransport {
  const frameCbs = new Set<(f: FrameEnvelope) => void>();
  const metaCbs = new Set<(m: MetaEnvelope) => void>();
  socket.on('browser:frame', (f) => { for (const cb of [...frameCbs]) cb(f); });
  socket.on('browser:meta', (m) => { for (const cb of [...metaCbs]) cb(m); });

  // PERF-2: coalesce pointer-move bursts to ~1 per animation frame. Disabled in
  // environments without requestAnimationFrame (e.g. tests) unless overridden.
  const raf = typeof requestAnimationFrame === 'function';
  const coalesce = opts?.coalesceInput ?? raf;
  let coalescer: ReturnType<typeof createInputCoalescer> | null = null;
  let currentBrowserId: string | null = null;
  if (coalesce && raf) {
    coalescer = createInputCoalescer(
      (ev) => { if (currentBrowserId) socket.emit('browser:input', { browserId: currentBrowserId, ...ev }); },
      { schedule: (cb) => requestAnimationFrame(cb), cancel: (h) => cancelAnimationFrame(h as number) },
    );
  }

  const ackTimeoutMs = opts?.ackTimeoutMs ?? 8000;
  const emitWithAck = (event: string, payload: unknown): Promise<any> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), ackTimeoutMs);
      socket.emit(event, payload, (ack: any) => { clearTimeout(timer); resolve(ack); });
    });

  return {
    async attach(sessionId, token, viewport) {
      const ack = await emitWithAck('browser:attach', { sessionId, token, viewport });
      if (!ack?.ok || !ack.browserId) throw new Error(ack?.error ?? 'browser:attach failed');
      return { browserId: ack.browserId, viewport: ack.viewport };
    },
    resize(browserId, viewport) {
      socket.emit('browser:resize', { browserId, viewport });
    },
    frameDone(browserId) {
      socket.emit('browser:frame_ack', { browserId });
    },
    input(browserId, event) {
      if (coalescer) { currentBrowserId = browserId; coalescer.push(event); return; }
      socket.emit('browser:input', { browserId, ...event });
    },
    detach(browserId) {
      socket.emit('browser:detach', { browserId });
    },
    onFrame(cb) { frameCbs.add(cb); return () => frameCbs.delete(cb); },
    onMeta(cb) { metaCbs.add(cb); return () => metaCbs.delete(cb); },
    dispose() { try { socket.disconnect(); } catch { /* ignore */ } },
  };
}
