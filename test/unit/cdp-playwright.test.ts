/**
 * CDP adapter (CDP-1/2/3) against a fake raw CDP — no real browser. CDP-4 (real
 * connectOverCDP / launch) is covered by the golden e2e (it.todo here).
 */
import { describe, expect, it } from 'vitest';
import { createCdpAdapter } from '../../src/core/cdp-playwright.js';
import { FakeRawCdp, FakeRawCdpSource } from '../helpers/fake-raw-cdp.js';

describe('CDP adapter', () => {
  it('CDP-1: send() forwards to the active raw target', async () => {
    const a = new FakeRawCdp('a');
    const cdp = createCdpAdapter(new FakeRawCdpSource(a));
    await cdp.send('Page.startScreencast', { format: 'jpeg' });
    expect(a.callsTo('Page.startScreencast')).toHaveLength(1);
  });

  it('CDP-1: events from the active target reach on() handlers', () => {
    const a = new FakeRawCdp('a');
    const cdp = createCdpAdapter(new FakeRawCdpSource(a));
    const frames: any[] = [];
    cdp.on('Page.screencastFrame', (f) => frames.push(f));
    a.fire('Page.screencastFrame', { sessionId: 1 });
    expect(frames).toHaveLength(1);
  });

  it('CDP-2: when the active target switches (new tab / cross-doc nav), screencast re-binds and frames follow', () => {
    const a = new FakeRawCdp('a');
    const b = new FakeRawCdp('b');
    const source = new FakeRawCdpSource(a);
    const cdp = createCdpAdapter(source);
    const frames: any[] = [];
    cdp.on('Page.screencastFrame', (f) => frames.push(f));

    // start streaming on the first target
    void cdp.send('Page.startScreencast', { format: 'jpeg' });
    a.fire('Page.screencastFrame', { sessionId: 1 });
    expect(frames).toHaveLength(1);

    // active target swaps → adapter must re-issue startScreencast on the new one
    source.switchTo(b);
    expect(b.callsTo('Page.startScreencast')).toHaveLength(1);

    // new target's frames flow; the OLD target's frames no longer do
    b.fire('Page.screencastFrame', { sessionId: 2 });
    a.fire('Page.screencastFrame', { sessionId: 99 });
    expect(frames).toHaveLength(2);
  });

  it.todo('CDP-3: real Page.frameNavigated → browser:meta{url,title} (golden e2e)');
  it.todo('CDP-4: createPlaywrightCdpFactory connects to CDP_URL or launches headful (golden e2e)');
  it.todo('CDP-4: Chromium crash → CdpFactory surfaces it; relaunch on retry (LIFE-6)');
});
