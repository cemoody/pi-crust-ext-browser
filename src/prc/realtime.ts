/**
 * Gateway wiring (GW-*): mounts the `browser:*` protocol on pi-crust's shared
 * Socket.IO realtime gateway via a per-connection handler, backed by the tested
 * BrowserService. Mirrors the terminal ext's pty:* wiring.
 *
 *   client → server : browser:attach { sessionId, token }  → ack { ok, browserId, viewport }
 *                     browser:input  { browserId, ... }
 *                     browser:detach { browserId }
 *   server → client : browser:frame  { browserId, seq, jpegB64, w, h }
 *                     browser:meta    { browserId, url, title, awaitingHuman?, reason? }
 *
 * Ownership is per-connection: viewerId === connection id, so a socket may only
 * touch browsers it attached (SEC-1), the disposer detaches everything on
 * disconnect (no leaks), and attach resolves+authorizes the pi session (GW-3 /
 * SEC-6 / SEC-8).
 *
 * STUB — throws until implemented.
 */
import type { BrowserService } from '../core/protocol.js';

/** Minimal per-connection facade (matches ctx.server.realtime's PrcRealtimeConnection). */
export interface RealtimeConnection {
  readonly id: string;
  on(event: string, handler: (payload: unknown, ack?: (response: unknown) => void) => void): void;
  emit(event: string, payload: unknown): void;
}

export interface BrowserGatewayDeps {
  readonly service: BrowserService;
  /** Resolve a pi session (cwd) by id; throws/returns undefined if unknown. */
  resolveSession(sessionId: string): Promise<{ cwd: string } | undefined>;
  /** Verify a live-view token is bound to the session (SEC-8). Optional in dev. */
  verifyToken?(token: string | undefined, sessionId: string): boolean;
}

/** Build the per-connection handler to pass to ctx.server.realtime.onConnection. */
export function makeBrowserConnectionHandler(
  _deps: BrowserGatewayDeps,
): (connection: RealtimeConnection) => () => void {
  throw new Error('NOT_IMPLEMENTED: makeBrowserConnectionHandler (GW-1/2/3)');
}
