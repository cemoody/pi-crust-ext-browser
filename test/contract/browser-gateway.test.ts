/**
 * GW-* — browser:* gateway wiring. Runs the per-connection handler against a
 * FakeRealtimeConnection + the REAL BrowserService (FakeCdpFactory behind it),
 * so the wiring is exercised without a Socket.IO server. RED until
 * makeBrowserConnectionHandler is implemented.
 */
import { describe, expect, it } from 'vitest';
import { createBrowserService } from '../../src/core/browser-service.js';
import { makeBrowserConnectionHandler } from '../../src/prc/realtime.js';
import { FakeCdpFactory } from '../helpers/fake-cdp-session.js';
import { FakeRealtimeConnection } from '../helpers/fake-realtime-connection.js';

function setup() {
  const cdpFactory = new FakeCdpFactory();
  const service = createBrowserService({ cdpFactory });
  const handler = makeBrowserConnectionHandler({
    service,
    resolveSession: async (id) => (id === 'pi-1' || id === 'pi-2' ? { cwd: '/work' } : undefined),
    verifyToken: (token, _sessionId) => token === 'good',
  });
  return { cdpFactory, service, handler };
}

describe('browser:* gateway', () => {
  it('GW-3: attach to an unknown pi session is rejected (socket stays usable)', async () => {
    const { handler } = setup();
    const conn = new FakeRealtimeConnection('sock-A');
    handler(conn);
    const ack = await conn.send('browser:attach', { sessionId: 'nope', token: 'good' });
    expect(ack).toMatchObject({ ok: false });
  });

  it('GW-3/SEC-8: attach with a bad/missing token is rejected', async () => {
    const { handler } = setup();
    const conn = new FakeRealtimeConnection('sock-A');
    handler(conn);
    expect(await conn.send('browser:attach', { sessionId: 'pi-1', token: 'bad' })).toMatchObject({ ok: false });
    expect(await conn.send('browser:attach', { sessionId: 'pi-1' })).toMatchObject({ ok: false });
  });

  it('GW-1: a valid attach acks { ok, browserId } and frames flow to that socket', async () => {
    const { handler, cdpFactory } = setup();
    const conn = new FakeRealtimeConnection('sock-A');
    handler(conn);
    const ack = await conn.send('browser:attach', { sessionId: 'pi-1', token: 'good' });
    expect(ack).toMatchObject({ ok: true, browserId: expect.any(String) });
    cdpFactory.sessions.get('pi-1')!.emitFrame();
    expect(conn.framesFor(ack.browserId)).toHaveLength(1);
  });

  it('GW-1/SEC-1: input on a browserId the socket did not attach is rejected', async () => {
    const { handler } = setup();
    const conn = new FakeRealtimeConnection('sock-A');
    handler(conn);
    const ack = await conn.send('browser:input', { browserId: 'br-stranger', kind: 'text', text: 'x' });
    expect(ack).toMatchObject({ ok: false });
  });

  it('MUX-2 (wire): two sockets on two sessions never receive each other’s frames', async () => {
    const { handler, cdpFactory } = setup();
    const a = new FakeRealtimeConnection('sock-A');
    const b = new FakeRealtimeConnection('sock-B');
    handler(a);
    handler(b);
    const ackA = await a.send('browser:attach', { sessionId: 'pi-1', token: 'good' });
    await b.send('browser:attach', { sessionId: 'pi-2', token: 'good' });
    cdpFactory.sessions.get('pi-1')!.emitFrame();
    expect(a.framesFor(ackA.browserId)).toHaveLength(1);
    expect(b.emittedOf('browser:frame')).toHaveLength(0);
  });

  it('GW-2: the disconnect disposer detaches the socket’s browsers (no leak)', async () => {
    const { handler, service, cdpFactory } = setup();
    const conn = new FakeRealtimeConnection('sock-A');
    const dispose = handler(conn);
    const ack = await conn.send('browser:attach', { sessionId: 'pi-1', token: 'good' });
    expect(service.isScreencasting(ack.browserId)).toBe(true);
    dispose();
    expect(service.isScreencasting(ack.browserId)).toBe(false);
    expect(cdpFactory.sessions.get('pi-1')!.callsTo('Page.stopScreencast')).toHaveLength(1);
  });
});
