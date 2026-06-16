/**
 * Gateway wiring (GW-*): mounts the `browser:*` protocol on pi-crust's shared
 * Socket.IO realtime gateway via a per-connection handler, backed by the tested
 * BrowserService. Mirrors the terminal ext's pty:* wiring.
 *
 *   client → server : browser:attach { sessionId, token }  → ack { ok, browserId, viewport }
 *                     browser:input  { browserId, ... }     → ack { ok }
 *                     browser:detach { browserId }          → ack { ok }
 *   server → client : browser:frame  { browserId, seq, jpegB64, w, h }
 *                     browser:meta    { browserId, url, title, awaitingHuman?, reason? }
 *
 * Ownership is per-connection: viewerId === connection id, so a socket may only
 * touch browsers it attached (SEC-1), the disposer detaches everything on
 * disconnect (no leaks), and attach resolves+authorizes the pi session
 * (GW-3 / SEC-6 / SEC-8).
 */
import type { BrowserService, InputEvent, Viewer } from '../core/protocol.js';

/** Minimal per-connection facade (matches ctx.server.realtime's PrcRealtimeConnection). */
export interface RealtimeConnection {
  readonly id: string;
  on(event: string, handler: (payload: unknown, ack?: (response: unknown) => void) => void): void;
  emit(event: string, payload: unknown): void;
}

export interface BrowserGatewayDeps {
  readonly service: BrowserService;
  /** Resolve a pi session (cwd) by id; returns undefined/throws if unknown. */
  resolveSession(sessionId: string): Promise<{ cwd: string } | undefined>;
  /** Verify a live-view token is bound to the session (SEC-8). Optional in dev. */
  verifyToken?(token: string | undefined, sessionId: string): boolean;
}

const ack = (cb: ((r: unknown) => void) | undefined, response: unknown): void => {
  if (typeof cb === 'function') cb(response);
};
const errOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Build the per-connection handler to pass to ctx.server.realtime.onConnection. */
export function makeBrowserConnectionHandler(
  deps: BrowserGatewayDeps,
): (connection: RealtimeConnection) => () => void {
  const { service, resolveSession, verifyToken } = deps;

  return (conn) => {
    // browserIds this connection attached; the only ones it may touch (SEC-1).
    const owned = new Set<string>();

    const makeViewer = (): Viewer => ({
      id: conn.id,
      onFrame: (frame) => conn.emit('browser:frame', frame),
      onMeta: (meta) => conn.emit('browser:meta', meta),
    });

    conn.on('browser:attach', (payload, cb) => {
      void (async () => {
        const p = rec(payload);
        const sessionId = str(p.sessionId);
        const token = str(p.token);
        if (!sessionId) {
          ack(cb, { ok: false, error: 'browser:attach requires a sessionId' });
          return;
        }
        // GW-3: the pi session must exist.
        let session: { cwd: string } | undefined;
        try {
          session = await resolveSession(sessionId);
        } catch {
          session = undefined;
        }
        if (!session) {
          ack(cb, { ok: false, error: `unknown session: ${sessionId}` });
          return;
        }
        // SEC-8: token must be bound to this session (when a verifier is wired).
        if (verifyToken && !verifyToken(token, sessionId)) {
          ack(cb, { ok: false, error: 'invalid live-view token' });
          return;
        }
        try {
          const browserId = await service.openSession(sessionId);
          await service.attach(browserId, makeViewer());
          owned.add(browserId);
          // Match the remote render to the viewer if it sent its size.
          const vp = (p as any).viewport;
          if (vp && typeof vp.width === 'number' && typeof vp.height === 'number') {
            await service.setViewport(browserId, vp).catch(() => {});
          }
          ack(cb, { ok: true, browserId, viewport: { width: 1280, height: 800 } });
        } catch (e) {
          ack(cb, { ok: false, error: errOf(e) });
        }
      })();
    });

    conn.on('browser:input', (payload, cb) => {
      void (async () => {
        const p = rec(payload);
        const browserId = str(p.browserId);
        if (!browserId || !owned.has(browserId)) {
          // SEC-1: never dispatch to a browser this socket didn't attach.
          ack(cb, { ok: false, error: 'not attached to that browser' });
          return;
        }
        const { browserId: _drop, ...event } = p;
        try {
          await service.input(browserId, conn.id, event as unknown as InputEvent);
          ack(cb, { ok: true });
        } catch (e) {
          ack(cb, { ok: false, error: errOf(e) });
        }
      })();
    });

    conn.on('browser:resize', (payload, cb) => {
      void (async () => {
        const p = rec(payload);
        const browserId = str(p.browserId);
        if (!browserId || !owned.has(browserId)) { ack(cb, { ok: false, error: 'not attached to that browser' }); return; }
        const vp = (p as any).viewport ?? p;
        try { await service.setViewport(browserId, { width: Number(vp.width), height: Number(vp.height), mobile: !!vp.mobile, deviceScaleFactor: Number(vp.deviceScaleFactor) || 1 }); ack(cb, { ok: true }); }
        catch (e) { ack(cb, { ok: false, error: errOf(e) }); }
      })();
    });

    conn.on('browser:detach', (payload, cb) => {
      void (async () => {
        const browserId = str(rec(payload).browserId);
        if (browserId && owned.has(browserId)) {
          owned.delete(browserId);
          try {
            await service.detach(browserId, conn.id);
          } catch {
            /* ignore */
          }
        }
        ack(cb, { ok: true });
      })();
    });

    // GW-2: disconnect → detach every browser this socket attached (no leaks).
    return () => {
      for (const browserId of [...owned]) {
        owned.delete(browserId);
        void service.detach(browserId, conn.id).catch(() => {});
      }
    };
  };
}
