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

  it('HOFF-3 (wire): browser:resume acks ok for an attached browser, and is rejected for an unowned one', async () => {
    const { handler } = setup();
    const conn = new FakeRealtimeConnection('sock-A');
    handler(conn);
    expect(await conn.send('browser:resume', { browserId: 'br-stranger' })).toMatchObject({ ok: false });
    const ack = await conn.send('browser:attach', { sessionId: 'pi-1', token: 'good' });
    const resumed = await conn.send('browser:resume', { browserId: (ack as any).browserId });
    expect(resumed).toMatchObject({ ok: true });
    expect(typeof (resumed as any).resumed).toBe('boolean');
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

  it('attach with a viewport emulates it on the remote; browser:resize re-emulates', async () => {
    const { handler, cdpFactory } = setup();
    const conn = new FakeRealtimeConnection('sock-A');
    handler(conn);
    const ack = await conn.send('browser:attach', { sessionId: 'pi-1', token: 'good', viewport: { width: 400, height: 800, mobile: true, deviceScaleFactor: 2 } });
    const cdp = cdpFactory.sessions.get('pi-1')!;
    expect(cdp.callsTo('Emulation.setDeviceMetricsOverride')).toHaveLength(1);
    await conn.send('browser:resize', { browserId: ack.browserId, viewport: { width: 500, height: 900, mobile: true, deviceScaleFactor: 2 } });
    expect(cdp.callsTo('Emulation.setDeviceMetricsOverride')).toHaveLength(2);
  });

  it('adaptive pacing: sends one frame, coalesces to the latest until the client acks', async () => {
    const { handler, cdpFactory } = setup();
    const conn = new FakeRealtimeConnection('sock-A');
    handler(conn);
    const ack = await conn.send('browser:attach', { sessionId: 'pi-1', token: 'good' });
    const cdp = cdpFactory.sessions.get('pi-1')!;
    cdp.emitFrame({ data: 'F1' });           // sent immediately
    cdp.emitFrame({ data: 'F2' });           // queued (in-flight) -> coalesced
    cdp.emitFrame({ data: 'F3' });           // replaces F2 (dropped)
    let frames = conn.framesFor(ack.browserId);
    expect(frames).toHaveLength(1);
    expect((frames[0].payload as any).jpegB64).toBe('F1');
    // client drew F1 and acks -> server sends the LATEST pending (F3), skipping F2
    await conn.send('browser:frame_ack', { browserId: ack.browserId });
    frames = conn.framesFor(ack.browserId);
    expect(frames).toHaveLength(2);
    expect((frames[1].payload as any).jpegB64).toBe('F3');
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
