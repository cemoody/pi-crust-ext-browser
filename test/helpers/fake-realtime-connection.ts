/**
 * FakeRealtimeConnection — emulates one ctx.server.realtime connection without
 * a real Socket.IO server. Records outbound emits, lets tests invoke inbound
 * handlers (with an ack), and exposes the disconnect disposer. Lets GW-* tests
 * run against the real BrowserService + FakeCdpFactory, no socket needed.
 */
import type { RealtimeConnection } from '../../src/prc/realtime.js';

export interface Emitted { event: string; payload: any }

export class FakeRealtimeConnection implements RealtimeConnection {
  readonly emitted: Emitted[] = [];
  private handlers = new Map<string, (payload: unknown, ack?: (r: unknown) => void) => void>();

  constructor(public readonly id: string) {}

  on(event: string, handler: (payload: unknown, ack?: (r: unknown) => void) => void): void {
    this.handlers.set(event, handler);
  }
  emit(event: string, payload: unknown): void {
    this.emitted.push({ event, payload });
  }

  // --- test controls ---
  /** Invoke an inbound handler as if the client emitted it; returns the ack. */
  async send(event: string, payload: unknown): Promise<any> {
    const handler = this.handlers.get(event);
    if (!handler) throw new Error(`no handler for ${event}`);
    return await new Promise((resolve) => {
      let acked = false;
      const ack = (r: unknown) => { acked = true; resolve(r); };
      const maybe = handler(payload, ack) as unknown;
      // If the handler didn't use the ack synchronously, resolve after a tick.
      Promise.resolve(maybe).then(() => { if (!acked) setTimeout(() => resolve(undefined), 0); });
    });
  }
  framesFor(browserId: string): Emitted[] {
    return this.emitted.filter((e) => e.event === 'browser:frame' && e.payload?.browserId === browserId);
  }
  emittedOf(event: string): Emitted[] {
    return this.emitted.filter((e) => e.event === event);
  }
}
