/**
 * HOFF-2 — browser_request_login emits a kind:html artifact pointing at the
 * token-scoped live-view route. The token is server-issued (passed in).
 */
import { describe, expect, it } from 'vitest';
import { buildLoginArtifact } from '../../src/prc/login-artifact.js';

describe('login artifact', () => {
  it('HOFF-2: result carries a kind:html artifact with the live-view route url', () => {
    const r = buildLoginArtifact('pi-1', 'Sign in to GitHub', { token: 'tok-abc' });
    const art = r.details.piRemoteControlArtifact;
    expect(art.kind).toBe('html');
    expect(art.url.startsWith('/api/ext/browser/live/pi-1')).toBe(true);
    expect(r.content[0].text).toContain('Sign in to GitHub');
  });

  it('HOFF-2/SEC-8: the server-issued token is embedded in the url', () => {
    const r = buildLoginArtifact('pi-1', 'reason', { token: 'tok-xyz' });
    const token = new URL('http://x' + r.details.piRemoteControlArtifact.url).searchParams.get('token');
    expect(token).toBe('tok-xyz');
  });
});
