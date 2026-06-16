/**
 * W-GW — widget rides the shared gateway, not a hardcoded WebSocket. Tests the
 * pure transport (createGatewayTransport) with a fake socket; DOM/e2e bits stay todo.
 */
import { describe, expect, it } from 'vitest';
import { createGatewayTransport, type GatewaySocket } from '../../src/web/gateway-client.js';

class FakeSocket implements GatewaySocket {
  handlers = new Map<string, (p: any) => void>();
  emitted: { event: string; payload: any }[] = [];
  ackResponder?: (event: string, payload: any) => any;
  disconnected = false;
  on(event: string, handler: (p: any) => void) { this.handlers.set(event, handler); }
  emit(event: string, payload: any, ack?: (r: any) => void) {
    this.emitted.push({ event, payload });
    if (ack && this.ackResponder) ack(this.ackResponder(event, payload));
  }
  disconnect() { this.disconnected = true; }
  fire(event: string, payload: any) { this.handlers.get(event)?.(payload); }
}

describe('widget gateway transport', () => {
  it('W-GW: attach emits browser:attach with sessionId+token and resolves browserId', async () => {
    const s = new FakeSocket();
    s.ackResponder = () => ({ ok: true, browserId: 'br-1', viewport: { width: 1280, height: 800 } });
    const t = createGatewayTransport(s);
    const r = await t.attach('pi-1', 'tok');
    expect(r.browserId).toBe('br-1');
    expect(s.emitted[0]).toEqual({ event: 'browser:attach', payload: { sessionId: 'pi-1', token: 'tok' } });
  });

  it('W-GW: a failed attach ack rejects', async () => {
    const s = new FakeSocket();
    s.ackResponder = () => ({ ok: false, error: 'nope' });
    const t = createGatewayTransport(s);
    await expect(t.attach('pi-1')).rejects.toThrow('nope');
  });

  it('W-GW: browser:frame events reach onFrame subscribers', () => {
    const s = new FakeSocket();
    const t = createGatewayTransport(s);
    const frames: any[] = [];
    t.onFrame((f) => frames.push(f));
    s.fire('browser:frame', { browserId: 'br-1', seq: 1, jpegB64: 'AQID', w: 1280, h: 800 });
    expect(frames).toHaveLength(1);
  });

  it('W-GW: input is sent as browser:input with the browserId', () => {
    const s = new FakeSocket();
    const t = createGatewayTransport(s);
    t.input('br-1', { kind: 'mouse', type: 'mousePressed', x: 5, y: 6, button: 'left', clickCount: 1 });
    const last = s.emitted.at(-1)!;
    expect(last.event).toBe('browser:input');
    expect(last.payload).toMatchObject({ browserId: 'br-1', kind: 'mouse', x: 5, y: 6 });
  });

  it('W-GW: detach emits browser:detach; dispose disconnects the socket', () => {
    const s = new FakeSocket();
    const t = createGatewayTransport(s);
    t.detach('br-1');
    expect(s.emitted.at(-1)).toEqual({ event: 'browser:detach', payload: { browserId: 'br-1' } });
    t.dispose();
    expect(s.disconnected).toBe(true);
  });

  it.todo('W-GW/DEPLOY-1: widget connects to same-origin /socket.io/ (jsdom)');
  it.todo('DEPLOY-2: sandboxed inline card connects with its session token (e2e)');
});
