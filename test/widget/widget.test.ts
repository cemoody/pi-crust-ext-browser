// @vitest-environment jsdom
/**
 * Widget React/DOM render tests. Mocks socket.io-client `io`, `fetch`, the 2d
 * canvas context, and `Image`, then renders the real widget component with the
 * host-injected React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

// --- controllable fake socket.io ------------------------------------------
let fakeSocket: any;
vi.mock('socket.io-client', () => ({
  io: () => fakeSocket,
}));

function makeFakeSocket() {
  const handlers = new Map<string, (p: any) => void>();
  return {
    emitted: [] as { event: string; payload: any }[],
    on(e: string, h: (p: any) => void) { handlers.set(e, h); },
    emit(e: string, p: any, ack?: (r: any) => void) {
      this.emitted.push({ event: e, payload: p });
      if (e === 'browser:attach' && ack) ack({ ok: true, browserId: 'br-1', viewport: { width: 1280, height: 800 } });
    },
    disconnect() { this.disconnected = true; },
    disconnected: false,
    fire(e: string, p: any) { handlers.get(e)?.(p); },
  };
}

let drawCalls: any[];
let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  fakeSocket = makeFakeSocket();
  drawCalls = [];
  // Stub the 2d context (jsdom has no canvas backend).
  (HTMLCanvasElement.prototype as any).getContext = () => ({ drawImage: (...a: any[]) => drawCalls.push(a) });
  // Image fires onload synchronously when src is set.
  vi.stubGlobal('Image', class { onload: any; set src(_v: string) { if (this.onload) this.onload(); } } as any);
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ token: 'tok-123' }) }) as any);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function renderWidget(api: any) {
  const mod = await import('../../src/web/widget.src.js');
  await act(async () => { root.render(mod.renderActivity({ React, api })); });
  // allow the async attach effect to settle
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const apiWithSession = { listSessions: async () => [{ id: 'pi-1' }] };

describe('widget (React/DOM)', () => {
  it('W-GW: resolves a session, fetches a token, and emits browser:attach', async () => {
    await renderWidget(apiWithSession);
    const attach = fakeSocket.emitted.find((e: any) => e.event === 'browser:attach');
    expect(attach).toBeTruthy();
    expect(attach.payload).toEqual({ sessionId: 'pi-1', token: 'tok-123' });
  });

  it('STR-1: a browser:frame draws to the canvas', async () => {
    await renderWidget(apiWithSession);
    await act(async () => { fakeSocket.fire('browser:frame', { browserId: 'br-1', seq: 1, jpegB64: 'AQID', w: 1280, h: 800 }); });
    expect(drawCalls.length).toBeGreaterThan(0);
  });

  it('STR-5: browser:meta updates the url bar', async () => {
    await renderWidget(apiWithSession);
    await act(async () => { fakeSocket.fire('browser:meta', { browserId: 'br-1', url: 'https://example.com/' }); });
    expect(container.querySelector('[data-testid=url]')!.textContent).toContain('example.com');
  });

  it('HOFF-6: awaitingHuman shows the banner; Resume POSTs and clears it', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => { calls.push(String(u)); return { ok: true, json: async () => ({ token: 'tok-123' }) } as any; });
    await renderWidget(apiWithSession);
    await act(async () => { fakeSocket.fire('browser:meta', { browserId: 'br-1', awaitingHuman: true, reason: 'Sign in to GitHub' }); });
    const banner = container.querySelector('[data-testid=awaiting-banner]');
    expect(banner?.textContent).toContain('Sign in to GitHub');
    await act(async () => { (banner!.querySelector('button') as HTMLButtonElement).click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(calls.some((u) => u.includes('/api/ext/browser/pi-1/resume'))).toBe(true);
    expect(container.querySelector('[data-testid=awaiting-banner]')).toBeNull();
  });

  it('INP-2: a canvas mousedown emits browser:input', async () => {
    await renderWidget(apiWithSession);
    const canvas = container.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 800 }) as any;
    await act(async () => { canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 20, bubbles: true })); });
    const input = fakeSocket.emitted.find((e: any) => e.event === 'browser:input' && e.payload.kind === 'mouse');
    expect(input?.payload).toMatchObject({ browserId: 'br-1', type: 'mousePressed' });
  });

  it('RVL-2: unmount detaches and disconnects the socket', async () => {
    await renderWidget(apiWithSession);
    await act(async () => { root.unmount(); });
    expect(fakeSocket.emitted.some((e: any) => e.event === 'browser:detach')).toBe(true);
    expect(fakeSocket.disconnected).toBe(true);
    // re-create a root so afterEach unmount is a no-op
    root = createRoot(container);
  });

  it('no-session: with no sessions, shows the no-session state and never attaches', async () => {
    await renderWidget({ listSessions: async () => [] });
    expect(fakeSocket.emitted.some((e: any) => e.event === 'browser:attach')).toBe(false);
    expect(container.textContent).toContain('no-session');
  });
});
