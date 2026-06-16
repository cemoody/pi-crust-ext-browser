/**
 * Core service acceptance tests against FakeCdpSession (no real browser).
 * Covers LIFE / STR / MUX / SEC / ERR P0 items. RED until BrowserService built.
 */
import { describe, expect, it } from 'vitest';
import { createBrowserService } from '../../src/core/browser-service.js';
import { BrowserError } from '../../src/core/protocol.js';
import { FakeCdpFactory, RecordingViewer } from '../helpers/fake-cdp-session.js';

function setup() {
  const cdpFactory = new FakeCdpFactory();
  const service = createBrowserService({ cdpFactory });
  return { cdpFactory, service };
}

describe('BrowserService — lifecycle', () => {
  it('LIFE-1: openSession reuses the browser for the same pi session', async () => {
    const { service, cdpFactory } = setup();
    const a = await service.openSession('pi-1');
    const b = await service.openSession('pi-1');
    expect(a).toBe(b);
    expect(cdpFactory.sessions.size).toBe(1);
  });

  it('LIFE-3: closeSession disposes the underlying CDP session (no orphans)', async () => {
    const { service, cdpFactory } = setup();
    await service.openSession('pi-1');
    await service.closeSession('pi-1');
    expect(cdpFactory.closed).toContain('pi-1');
  });

  it('LIFE-9: exceeding maxSessions throws TOO_MANY_SESSIONS', async () => {
    const cdpFactory = new FakeCdpFactory();
    const service = createBrowserService({ cdpFactory, maxSessions: 1 });
    await service.openSession('pi-1');
    await expect(service.openSession('pi-2')).rejects.toMatchObject({ code: 'TOO_MANY_SESSIONS' });
  });
});

describe('BrowserService — streaming', () => {
  it('STR-2: no screencast and no frames until a viewer attaches', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    expect(service.isScreencasting(id)).toBe(false);
    expect(cdpFactory.sessions.get('pi-1')!.callsTo('Page.startScreencast')).toHaveLength(0);
  });

  it('STR-1: first attach starts the screencast exactly once', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    await service.attach(id, new RecordingViewer('v1'));
    expect(service.isScreencasting(id)).toBe(true);
    expect(cdpFactory.sessions.get('pi-1')!.callsTo('Page.startScreencast')).toHaveLength(1);
  });

  it('STR-3: last detach stops the screencast', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    await service.attach(id, new RecordingViewer('v1'));
    await service.detach(id, 'v1');
    expect(service.isScreencasting(id)).toBe(false);
    expect(cdpFactory.sessions.get('pi-1')!.callsTo('Page.stopScreencast')).toHaveLength(1);
  });

  it('STR-4/6: frames fan out with monotonic seq and are acked', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    const v = new RecordingViewer('v1');
    await service.attach(id, v);
    const cdp = cdpFactory.sessions.get('pi-1')!;
    cdp.emitFrame();
    cdp.emitFrame();
    expect(v.frames.map((f) => f.seq)).toEqual([1, 2]);
    expect(cdp.callsTo('Page.screencastFrameAck')).toHaveLength(2);
  });

  it('STR-5: navigation pushes a meta with the new url', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    const v = new RecordingViewer('v1');
    await service.attach(id, v);
    cdpFactory.sessions.get('pi-1')!.emitNavigated('https://example.com/');
    expect(v.metas.some((m) => m.url === 'https://example.com/')).toBe(true);
  });
});

describe('BrowserService — multiplex & ownership', () => {
  it('MUX-2: zero cross-talk between two sessions', async () => {
    const { service, cdpFactory } = setup();
    const a = await service.openSession('pi-A');
    const b = await service.openSession('pi-B');
    const va = new RecordingViewer('va');
    const vb = new RecordingViewer('vb');
    await service.attach(a, va);
    await service.attach(b, vb);
    cdpFactory.sessions.get('pi-A')!.emitFrame();
    expect(va.frames).toHaveLength(1);
    expect(vb.frames).toHaveLength(0);
  });

  it('MUX-1: two viewers of one session both receive frames', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    const v1 = new RecordingViewer('v1');
    const v2 = new RecordingViewer('v2');
    await service.attach(id, v1);
    await service.attach(id, v2);
    cdpFactory.sessions.get('pi-1')!.emitFrame();
    expect(v1.frames).toHaveLength(1);
    expect(v2.frames).toHaveLength(1);
  });

  it('SEC-1: input from a viewer that did not attach is rejected', async () => {
    const { service } = setup();
    const id = await service.openSession('pi-1');
    await service.attach(id, new RecordingViewer('v1'));
    await expect(service.input(id, 'stranger', { kind: 'text', text: 'x' }))
      .rejects.toBeInstanceOf(BrowserError);
  });

  it('SEC-1: owning viewer input dispatches to CDP', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    await service.attach(id, new RecordingViewer('v1'));
    await service.input(id, 'v1', { kind: 'mouse', type: 'mousePressed', x: 1, y: 1, button: 'left', clickCount: 1 });
    expect(cdpFactory.sessions.get('pi-1')!.callsTo('Input.dispatchMouseEvent')).toHaveLength(1);
  });
});

describe('BrowserService — errors', () => {
  it('ERR-1: attach to unknown browserId rejects, no throw-crash', async () => {
    const { service } = setup();
    await expect(service.attach('nope', new RecordingViewer('v1'))).rejects.toBeInstanceOf(BrowserError);
  });

  it('ERR-2: double attach by one viewer is idempotent (one stream)', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    await service.attach(id, new RecordingViewer('v1'));
    await service.attach(id, new RecordingViewer('v1'));
    expect(cdpFactory.sessions.get('pi-1')!.callsTo('Page.startScreencast')).toHaveLength(1);
  });
});
