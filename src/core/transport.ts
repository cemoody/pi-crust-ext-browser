/**
 * Transport URL helpers (DEPLOY-1). The widget must ride the SAME origin the
 * page loaded from — never a hardcoded host/port — so it works behind a reverse
 * proxy / tailnet / PWA, not just on localhost.
 *
 * STUBS — throw until implemented.
 */

/** Socket.IO mount path the extension's browser:* handlers live on. */
export function gatewaySocketPath(): string {
  throw new Error('NOT_IMPLEMENTED: gatewaySocketPath (DEPLOY-1)');
}

/**
 * Resolve the gateway origin from the page's own location origin. Must echo the
 * given origin (same-origin) and must NOT return a hardcoded host/port.
 */
export function resolveGatewayOrigin(_locationOrigin: string): string {
  throw new Error('NOT_IMPLEMENTED: resolveGatewayOrigin (DEPLOY-1)');
}

/**
 * Build the relative URL for the Tier-B inline live-view route. Must be a
 * RELATIVE path (starts with /api/) so the host resolves it against its own
 * origin; carries the session-scoped token (SEC-8).
 */
export function liveViewRouteUrl(_sessionId: string, _token: string): string {
  throw new Error('NOT_IMPLEMENTED: liveViewRouteUrl (DEPLOY-1/SEC-8)');
}
