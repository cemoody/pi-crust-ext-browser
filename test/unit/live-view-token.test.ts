/**
 * SEC-8 / DEPLOY-2 — session-scoped live-view tokens. RED until implemented.
 */
import { describe, expect, it } from 'vitest';
import { mintLiveViewToken, verifyLiveViewToken } from '../../src/core/live-view-token.js';

const secret = 'test-secret-please-change';

describe('live-view token', () => {
  it('SEC-8: a freshly minted token verifies for its own session', () => {
    const token = mintLiveViewToken('pi-1', { secret });
    expect(verifyLiveViewToken(token, 'pi-1', { secret })).toBe(true);
  });

  it('SEC-6/SEC-8: a token for session A does NOT verify for session B', () => {
    const token = mintLiveViewToken('pi-A', { secret });
    expect(verifyLiveViewToken(token, 'pi-B', { secret })).toBe(false);
  });

  it('SEC-8: a tampered token fails verification', () => {
    const token = mintLiveViewToken('pi-1', { secret });
    expect(verifyLiveViewToken(token + 'x', 'pi-1', { secret })).toBe(false);
  });

  it('SEC-8: a token minted with a different secret fails', () => {
    const token = mintLiveViewToken('pi-1', { secret: 'other' });
    expect(verifyLiveViewToken(token, 'pi-1', { secret })).toBe(false);
  });

  it('SEC-8: an expired token fails after expiry', () => {
    const token = mintLiveViewToken('pi-1', { secret, expiresAt: 1_000 });
    expect(verifyLiveViewToken(token, 'pi-1', { secret, now: 2_000 })).toBe(false);
    expect(verifyLiveViewToken(token, 'pi-1', { secret, now: 500 })).toBe(true);
  });

  it('SEC-8: malformed input returns false, never throws', () => {
    expect(verifyLiveViewToken('', 'pi-1', { secret })).toBe(false);
    expect(verifyLiveViewToken('not.a.token', 'pi-1', { secret })).toBe(false);
  });
});
