/**
 * Session-scoped tokens for the Tier-B inline live-view route (SEC-8 / DEPLOY-2).
 * The sandboxed (allow-scripts, opaque-origin) inline card must authenticate to
 * the gateway with a token that is bound to ONE pi session and unforgeable
 * without the server secret.
 *
 * STUBS — throw until implemented.
 */
export interface LiveViewTokenOptions {
  /** Server-side secret (never shipped to the client). */
  readonly secret: string;
  /** Optional expiry in ms since epoch. */
  readonly expiresAt?: number;
}

/** Mint a token that authorizes live-view access to exactly `sessionId`. */
export function mintLiveViewToken(_sessionId: string, _opts: LiveViewTokenOptions): string {
  throw new Error('NOT_IMPLEMENTED: mintLiveViewToken (SEC-8/DEPLOY-2)');
}

/** Verify a token is valid AND bound to `sessionId`. Never throws on bad input. */
export function verifyLiveViewToken(
  _token: string,
  _sessionId: string,
  _opts: LiveViewTokenOptions & { now?: number },
): boolean {
  throw new Error('NOT_IMPLEMENTED: verifyLiveViewToken (SEC-8/DEPLOY-2)');
}
