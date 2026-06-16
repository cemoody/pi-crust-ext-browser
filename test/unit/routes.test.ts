/**
 * GW-4 — token / live-view / resume / navigate routes. RED until implemented.
 */
import { describe, expect, it } from 'vitest';
import { createBrowserRoutes, type RouteRequest } from '../../src/prc/routes.js';
import { createBrowserService } from '../../src/core/browser-service.js';
import { verifyLiveViewToken } from '../../src/core/live-view-token.js';
import { FakeCdpFactory } from '../helpers/fake-cdp-session.js';

const secret = 'route-secret';
function setup() {
  const cdpFactory = new FakeCdpFactory();
  const service = createBrowserService({ cdpFactory });
  const routes = createBrowserRoutes({
    service,
    secret,
    resolveSession: async (id) => (id === 'pi-1' ? { cwd: '/w' } : undefined),
  });
  return { service, cdpFactory, routes };
}
const req = (over: Partial<RouteRequest> & { body?: unknown } = {}): RouteRequest => ({
  params: over.params ?? {},
  url: over.url ?? new URL('http://h/'),
  json: async () => (over.body ?? {}) as any,
});

describe('browser routes', () => {
  it('GW-4: POST token mints a session-bound token; unknown session 404s', async () => {
    const { routes } = setup();
    const ok = await routes.token(req({ body: { sessionId: 'pi-1' } }));
    expect(ok.status).toBe(200);
    const token = (ok.body as any).token as string;
    expect(verifyLiveViewToken(token, 'pi-1', { secret })).toBe(true);
    expect((await routes.token(req({ body: { sessionId: 'ghost' } }))).status).toBe(404);
  });

  it('GW-4/SEC-8: live-view serves HTML only with a valid token', async () => {
    const { routes } = setup();
    const minted = (await routes.token(req({ body: { sessionId: 'pi-1' } }))).body as any;
    const good = await routes.liveView(req({
      params: { sessionId: 'pi-1' },
      url: new URL(`http://h/api/ext/browser/live/pi-1?token=${encodeURIComponent(minted.token)}`),
    }));
    expect(good.status).toBe(200);
    expect(String(good.body)).toContain('<canvas');
    const bad = await routes.liveView(req({
      params: { sessionId: 'pi-1' },
      url: new URL('http://h/api/ext/browser/live/pi-1?token=forged'),
    }));
    expect(bad.status).toBe(403);
  });

  it('HOFF-3: resume resolves a pending wait_for_human', async () => {
    const { routes, service } = setup();
    const browserId = await service.openSession('pi-1');
    service.requestLogin(browserId, 'sign in');
    const waiting = service.waitForHuman(browserId, { timeoutMs: 1000 });
    const res = await routes.resume(req({ params: { sessionId: 'pi-1' } }));
    expect(res.body).toEqual({ resumed: true });
    await expect(waiting).resolves.toEqual({ resumed: true });
  });

  it('TOOL-2: navigate drives the browser via CDP Page.navigate', async () => {
    const { routes, cdpFactory } = setup();
    const res = await routes.navigate(req({ params: { sessionId: 'pi-1' }, body: { url: 'https://example.com' } }));
    expect(res.status).toBe(200);
    expect(cdpFactory.sessions.get('pi-1')!.callsTo('Page.navigate')).toHaveLength(1);
  });

  it('HOFF-1: request-login sets awaiting + returns a session-bound token', async () => {
    const { routes, service } = setup();
    const res = await routes.requestLogin(req({ params: { sessionId: 'pi-1' }, body: { reason: 'GitHub' } }));
    expect(res.status).toBe(200);
    const token = (res.body as any).token as string;
    expect(verifyLiveViewToken(token, 'pi-1', { secret })).toBe(true);
    const browserId = await service.openSession('pi-1');
    expect(service.isAwaitingHuman(browserId)).toBe(true);
  });

  it('HOFF-3: wait blocks until resume, then resolves', async () => {
    const { routes } = setup();
    await routes.requestLogin(req({ params: { sessionId: 'pi-1' }, body: { reason: 'x' } }));
    const waiting = routes.wait(req({ params: { sessionId: 'pi-1' }, body: { timeoutMs: 1000 } }));
    await new Promise((r) => setTimeout(r, 10)); // let wait register its waiter
    const resumed = await routes.resume(req({ params: { sessionId: 'pi-1' } }));
    expect(resumed.body).toEqual({ resumed: true });
    expect((await waiting).body).toEqual({ resumed: true });
  });

  it('wait/resume on a session with no browser are no-ops (no spurious Chromium)', async () => {
    const { routes, service } = setup();
    expect((await routes.resume(req({ params: { sessionId: 'pi-1' } }))).body).toEqual({ resumed: false });
    expect((await routes.wait(req({ params: { sessionId: 'pi-1' }, body: {} }))).body).toEqual({ resumed: false });
    expect(service.hasSession('pi-1')).toBe(false);
  });
});
