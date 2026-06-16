/**
 * HOFF-2 — browser_request_login emits a kind:html artifact pointing at the
 * token-scoped live-view route.
 */
import { describe, expect, it } from 'vitest';
import { buildLoginArtifact } from '../../src/prc/login-artifact.js';
import { verifyLiveViewToken } from '../../src/core/live-view-token.js';

const secret = 'srv-secret';

describe('login artifact', () => {
  it('HOFF-2: result carries a kind:html artifact with the live-view route url', () => {
    const r = buildLoginArtifact('pi-1', 'Sign in to GitHub', { secret });
    const art = r.details.piRemoteControlArtifact;
    expect(art.kind).toBe('html');
    expect(art.url.startsWith('/api/ext/browser/live/pi-1')).toBe(true);
    expect(r.content[0].text).toContain('Sign in to GitHub');
  });

  it('HOFF-2/SEC-8: the embedded token verifies for that session', () => {
    const r = buildLoginArtifact('pi-1', 'reason', { secret });
    const token = new URL('http://x' + r.details.piRemoteControlArtifact.url).searchParams.get('token')!;
    expect(verifyLiveViewToken(token, 'pi-1', { secret })).toBe(true);
    expect(verifyLiveViewToken(token, 'pi-OTHER', { secret })).toBe(false);
  });
});
