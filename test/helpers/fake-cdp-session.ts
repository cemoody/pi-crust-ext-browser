/**
 * FakeCdpSession — the workhorse harness. Implements the CdpSession surface
 * with NO real browser, records every `send(method, params)`, and lets tests
 * push synthetic `Page.screencastFrame` events. Deterministic + millisecond-fast.
 */
import type { CdpFactory, CdpSession, Viewer, FrameEnvelope, MetaEnvelope } from '../../src/core/protocol.js';

export interface SentCall { method: string; params?: Record<string, unknown> }

export class FakeCdpSession implements CdpSession {
  readonly sent: SentCall[] = [];
  private handlers = new Map<string, Set<(p: any) => void>>();
  private frameSession = 0;

  /** Settable result for Runtime.evaluate (snapshot tests). */
  evaluateValue: unknown = undefined;
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.sent.push({ method, params });
    if (method === 'Page.startScreencast') this.frameSession += 1;
    if (method === 'Runtime.evaluate') return { result: { value: this.evaluateValue } };
    return {};
  }
  on(event: string, handler: (p: any) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  off(event: string, handler: (p: any) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  // --- test controls ---
  /** Push a synthetic screencast frame. */
  emitFrame(opts: { data?: string; w?: number; h?: number } = {}): void {
    const sessionId = this.frameSession;
    this.fire('Page.screencastFrame', {
      data: opts.data ?? 'AQID', // base64 of [1,2,3]
      sessionId,
      metadata: { deviceWidth: opts.w ?? 1280, deviceHeight: opts.h ?? 800, offsetTop: 0, pageScaleFactor: 1 },
    });
  }
  emitNavigated(url: string): void {
    this.fire('Page.frameNavigated', { frame: { url } });
  }
  emitCrashed(): void {
    this.fire('Target.crashed', {});
  }
  callsTo(method: string): SentCall[] {
    return this.sent.filter((c) => c.method === method);
  }
  private fire(event: string, params: any): void {
    for (const h of [...(this.handlers.get(event) ?? [])]) h(params);
  }
}

/** A CdpFactory that hands out FakeCdpSessions, one per pi session, recorded. */
export class FakeCdpFactory implements CdpFactory {
  readonly sessions = new Map<string, FakeCdpSession>();
  closed: string[] = [];
  async create(piSessionId: string): Promise<{ session: FakeCdpSession; close(): Promise<void> }> {
    const session = new FakeCdpSession();
    this.sessions.set(piSessionId, session);
    return {
      session,
      close: async () => {
        this.closed.push(piSessionId);
      },
    };
  }
}

/** A Viewer that records the frames/meta it received. */
export class RecordingViewer implements Viewer {
  readonly frames: FrameEnvelope[] = [];
  readonly metas: MetaEnvelope[] = [];
  constructor(public readonly id: string) {}
  onFrame(frame: FrameEnvelope): void {
    this.frames.push(frame);
  }
  onMeta(meta: MetaEnvelope): void {
    this.metas.push(meta);
  }
}
