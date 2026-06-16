/**
 * Server activation wiring + LLM tool registration. Uses fake host contexts so
 * we assert registrations without the real pi-crust/pi runtime.
 */
import { describe, expect, it } from 'vitest';
import activate from '../../src/prc/server.js';
import browserPiExtension from '../../src/pi/index.js';

function fakePrc() {
  const calls: any = { activities: [], routes: [], realtime: 0 };
  const api = {
    post: (p: string, h: any) => calls.routes.push(['POST', p, h]),
    get: (p: string, h: any) => calls.routes.push(['GET', p, h]),
  };
  return {
    calls,
    activity: { registerView: (v: any) => calls.activities.push(v) },
    sessions: { get: async (_id: string) => ({ cwd: '/w' }) },
    server: {
      api,
      realtime: { onConnection: (_h: any) => { calls.realtime += 1; } },
    },
  };
}

describe('server activate (HOST-1 / wiring)', () => {
  it('throws a clear error when ctx.server.realtime is missing (HOST-1)', () => {
    expect(() => activate({ server: {} } as any)).toThrow(/ctx\.server\.realtime/);
  });

  it('registers the Browser activity, a realtime handler, and the routes', () => {
    const prc = fakePrc();
    activate(prc as any);
    expect(prc.calls.activities).toContainEqual(expect.objectContaining({ id: 'cemoody.browser.activity', title: 'Browser' }));
    expect(prc.calls.realtime).toBe(1);
    const routePaths = prc.calls.routes.map((r: any[]) => `${r[0]} ${r[1]}`);
    expect(routePaths).toEqual(expect.arrayContaining([
      'POST /api/ext/browser/token',
      'GET /api/ext/browser/live/:sessionId',
      'POST /api/ext/browser/:sessionId/resume',
      'POST /api/ext/browser/:sessionId/navigate',
    ]));
  });
});

describe('pi tools registration', () => {
  it('registers the browser_* tools incl. request_login', () => {
    const names: string[] = [];
    browserPiExtension({ registerTool: (t: any) => names.push(t.name) } as any);
    expect(names).toEqual(expect.arrayContaining([
      'browser_open', 'browser_navigate', 'browser_request_login', 'browser_wait_for_human',
    ]));
  });

  it('browser_request_login returns a kind:html artifact for the session', async () => {
    let loginTool: any;
    browserPiExtension({ registerTool: (t: any) => { if (t.name === 'browser_request_login') loginTool = t; } } as any);
    const out = await loginTool.execute('id', { reason: 'GitHub' }, { sessionId: 'pi-9' });
    expect(out.details.piRemoteControlArtifact.kind).toBe('html');
    expect(out.details.piRemoteControlArtifact.url).toContain('pi-9');
  });
});
