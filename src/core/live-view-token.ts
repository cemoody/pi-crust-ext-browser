/**
 * Session-scoped tokens for the Tier-B inline live-view route (SEC-8 / DEPLOY-2).
 * The sandboxed (allow-scripts, opaque-origin) inline card must authenticate to
 * the gateway with a token bound to ONE pi session and unforgeable without the
 * server secret. HMAC-SHA256 over a compact `{sid,exp}` payload.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface LiveViewTokenOptions {
  /** Server-side secret (never shipped to the client). */
  readonly secret: string;
  /** Optional expiry in ms since epoch. */
  readonly expiresAt?: number;
}

interface TokenPayload {
  sid: string;
  exp?: number;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/** Mint a token that authorizes live-view access to exactly `sessionId`. */
export function mintLiveViewToken(sessionId: string, opts: LiveViewTokenOptions): string {
  const payload: TokenPayload = { sid: sessionId, ...(opts.expiresAt !== undefined ? { exp: opts.expiresAt } : {}) };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, opts.secret)}`;
}

/** Verify a token is valid AND bound to `sessionId`. Never throws on bad input. */
export function verifyLiveViewToken(
  token: string,
  sessionId: string,
  opts: LiveViewTokenOptions & { now?: number },
): boolean {
  try {
    if (typeof token !== 'string') return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false;
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    // Constant-time signature check.
    const expected = sign(payloadB64, opts.secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as TokenPayload;
    if (payload.sid !== sessionId) return false;
    if (payload.exp !== undefined) {
      const now = opts.now ?? Date.now();
      if (now > payload.exp) return false;
    }
    return true;
  } catch {
    return false;
  }
}
