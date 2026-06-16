/**
 * Transport URL helpers (DEPLOY-1). The widget must ride the SAME origin the
 * page loaded from — never a hardcoded host/port — so it works behind a reverse
 * proxy / tailnet / PWA, not just on localhost.
 */

/** Socket.IO mount path the extension's browser:* handlers live on. */
export function gatewaySocketPath(): string {
  return '/socket.io/';
}

/**
 * Resolve the gateway origin from the page's own location origin. Echoes the
 * given origin (same-origin) — never a hardcoded host/port.
 */
export function resolveGatewayOrigin(locationOrigin: string): string {
  return locationOrigin;
}

/**
 * Build the relative URL for the Tier-B inline live-view route. Relative path
 * (starts with /api/) so the host resolves it against its own origin; carries
 * the session-scoped token (SEC-8).
 */
export function liveViewRouteUrl(sessionId: string, token: string): string {
  return `/api/ext/browser/live/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`;
}
