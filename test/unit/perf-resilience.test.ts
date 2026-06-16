/**
 * PERF-* / RES-* — backpressure (via pacing.test), crash recovery, leak guard,
 * snapshot. Pacing primitives live in pacing.test.ts; these exercise the
 * service-level behaviors against FakeCdpSession.
 */
import { describe, expect, it } from 'vitest';
import { createBrowserService } from '../../src/core/browser-service.js';
import { FakeCdpFactory, RecordingViewer } from '../helpers/fake-cdp-session.js';

function setup() {
  const cdpFactory = new FakeCdpFactory();
  const service = createBrowserService({ cdpFactory });
  return { cdpFactory, service };
}

describe('resilience & lifecycle', () => {
  it('RES-3: a target crash emits browser:meta{closed} and stops the screencast', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    const v = new RecordingViewer('v1');
    await service.attach(id, v);
    cdpFactory.sessions.get('pi-1')!.emitCrashed();
    expect(v.metas.some((m) => m.closed === true)).toBe(true);
    expect(service.isScreencasting(id)).toBe(false);
  });

  it('PERF-5: N attach/detach cycles return screencast state to baseline (leak guard)', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    for (let i = 0; i < 50; i++) {
      await service.attach(id, new RecordingViewer(`v${i}`));
      await service.detach(id, `v${i}`);
    }
    expect(service.isScreencasting(id)).toBe(false);
    const cdp = cdpFactory.sessions.get('pi-1')!;
    // start/stop balanced — no accumulation.
    expect(cdp.callsTo('Page.startScreencast').length).toBe(cdp.callsTo('Page.stopScreencast').length);
  });

  it('TOOL-4/SEC-3: snapshot returns url/title/text and never includes input values', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    cdpFactory.sessions.get('pi-1')!.evaluateValue = { url: 'https://x/', title: 'X', text: 'visible page text' };
    const snap = await service.snapshot(id);
    expect(snap).toEqual({ url: 'https://x/', title: 'X', text: 'visible page text' });
  });

  it('TOOL-2: navigate issues CDP Page.navigate', async () => {
    const { service, cdpFactory } = setup();
    const id = await service.openSession('pi-1');
    await service.navigate(id, 'https://example.com');
    expect(cdpFactory.sessions.get('pi-1')!.callsTo('Page.navigate')).toHaveLength(1);
  });

  it('LIFE-5: the idle reaper closes a browser with no viewers + no activity', async () => {
    let clock = 1_000;
    const cdpFactory = new FakeCdpFactory();
    const service = createBrowserService({ cdpFactory, idleMs: 5_000, reapIntervalMs: 1_000, now: () => clock });
    const id = await service.openSession('pi-idle');
    expect(service.hasSession('pi-idle')).toBe(true);
    clock += 10_000; // advance past idleMs
    await new Promise((r) => setTimeout(r, 1_200)); // let one reap interval fire
    expect(service.hasSession('pi-idle')).toBe(false);
    expect(cdpFactory.closed).toContain('pi-idle');
    expect(service.isScreencasting(id)).toBe(false);
    await service.dispose();
  });

  it('LIFE-5: a browser WITH a viewer is not reaped', async () => {
    let clock = 1_000;
    const cdpFactory = new FakeCdpFactory();
    const service = createBrowserService({ cdpFactory, idleMs: 5_000, reapIntervalMs: 1_000, now: () => clock });
    const id = await service.openSession('pi-live');
    await service.attach(id, new RecordingViewer('v1'));
    clock += 10_000;
    await new Promise((r) => setTimeout(r, 1_200));
    expect(service.hasSession('pi-live')).toBe(true);
    await service.dispose();
  });

  it.todo('PERF-3 (e2e, soft): input→observable DOM change < 300ms locally');
  it.todo('PERF-4 (e2e): median JPEG frame under the configured byte cap');
  it.todo('LIFE-6 (e2e): Chromium crash → factory relaunches on retry');
});
