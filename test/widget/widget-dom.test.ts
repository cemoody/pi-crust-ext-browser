// @vitest-environment jsdom
/**
 * W-GW / DEPLOY-1 in a DOM: the transport resolves the SAME origin the page
 * loaded from (no hardcoded host/port), and coalesces pointer-move bursts when
 * requestAnimationFrame is available (PERF-2).
 */
import { describe, expect, it } from 'vitest';
import { createGatewayTransport, type GatewaySocket } from '../../src/web/gateway-client.js';
import { liveViewRouteUrl, resolveGatewayOrigin } from '../../src/core/transport.js';

class FakeSocket implements GatewaySocket {
  handlers = new Map<string, (p: any) => void>();
  emitted: { event: string; payload: any }[] = [];
  on(e: string, h: (p: any) => void) { this.handlers.set(e, h); }
  emit(e: string, p: any) { this.emitted.push({ event: e, payload: p }); }
  disconnect() {}
}

describe('widget transport in a DOM (DEPLOY-1 / PERF-2)', () => {
  it('DEPLOY-1: resolves the page origin, never a hardcoded host', () => {
    const origin = window.location.origin;
    expect(resolveGatewayOrigin(origin)).toBe(origin);
    expect(resolveGatewayOrigin(origin)).not.toContain('4000');
    expect(liveViewRouteUrl('pi-1', 't')).toMatch(/^\/api\//);
  });

  it('PERF-2: pointer-move bursts coalesce to one browser:input per frame', async () => {
    if (typeof requestAnimationFrame !== 'function') return; // env without rAF — skip
    const s = new FakeSocket();
    const t = createGatewayTransport(s, { coalesceInput: true });
    t.input('br-1', { kind: 'mouse', type: 'mouseMoved', x: 1, y: 1 });
    t.input('br-1', { kind: 'mouse', type: 'mouseMoved', x: 2, y: 2 });
    t.input('br-1', { kind: 'mouse', type: 'mouseMoved', x: 3, y: 3 });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => setTimeout(r, 20));
    const moves = s.emitted.filter((e) => e.event === 'browser:input');
    expect(moves).toHaveLength(1);
    expect(moves[0].payload).toMatchObject({ browserId: 'br-1', x: 3, y: 3 });
  });
});
