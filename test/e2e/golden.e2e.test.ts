/**
 * Golden e2e (real Chromium via CDP). Asserts the loop via STATE ROUND-TRIPS,
 * not pixel diffs.
 *
 * Run against a CDP endpoint (recommended — a Steel container or any Chrome):
 *   E2E_CHROMIUM_CDP_URL=ws://127.0.0.1:3000/ \
 *     npx vitest run --config vitest.e2e.config.ts
 * Without that env it launches a local headless Chromium (needs a browser binary).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserService } from '../../src/core/browser-service.js';
import { createPlaywrightCdpFactory } from '../../src/core/cdp-playwright.js';
import type { Viewer, FrameEnvelope, MetaEnvelope } from '../../src/core/protocol.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PORT = 9333;

class Rec implements Viewer {
  frames: FrameEnvelope[] = [];
  metas: MetaEnvelope[] = [];
  constructor(public id: string) {}
  onFrame(f: FrameEnvelope) { this.frames.push(f); }
  onMeta(m: MetaEnvelope) { this.metas.push(m); }
}

let launched: any;
let cdpUrl = process.env.E2E_CHROMIUM_CDP_URL ?? `http://127.0.0.1:${PORT}`;
let pw: any;

beforeAll(async () => {
  pw = await import('playwright-core').catch(() => import('playwright' as string));
  if (!process.env.E2E_CHROMIUM_CDP_URL) {
    launched = await pw.chromium.launch({ headless: true, args: [`--remote-debugging-port=${PORT}`] });
    await sleep(800);
  }
});
afterAll(async () => { try { await launched?.close(); } catch { /* ignore */ } });

describe('golden e2e (real browser)', () => {
  it('streams frames, follows navigation, and round-trips human input', async () => {
    const service = createBrowserService({ cdpFactory: createPlaywrightCdpFactory({ cdpUrl }) });
    const id = await service.openSession('e2e');
    const v = new Rec('v1');
    await service.attach(id, v);

    // E/B + E/CDP-3: navigate → frames flow and meta reflects the url.
    await service.navigate(id, 'https://example.com/');
    await sleep(2500);
    expect(v.frames.length).toBeGreaterThan(0);
    expect(v.metas.some((m) => (m.url ?? '').includes('example.com'))).toBe(true);

    // E/CDP-2: navigate again → still streaming the new page.
    const before = v.frames.length;
    await service.navigate(id, 'https://github.com/login');
    await sleep(2500);
    expect(v.frames.length).toBeGreaterThan(before);
    expect(v.metas.some((m) => (m.url ?? '').includes('github.com'))).toBe(true);

    // E/INP-4: type into the focused username field via service.input, then read
    // it back through a direct CDP connection (proves input → CDP → DOM).
    const verify = await pw.chromium.connectOverCDP(cdpUrl);
    const page = verify.contexts()[0].pages()[0];
    await page.focus('#login_field');
    for (const ch of 'octocat') {
      await service.input(id, 'v1', { kind: 'key', type: 'keyDown', key: ch });
      await service.input(id, 'v1', { kind: 'key', type: 'keyUp', key: ch });
    }
    await sleep(300);
    const value = await page.inputValue('#login_field');
    await verify.close();
    expect(value).toBe('octocat');

    await service.closeSession('e2e');
  });
});
