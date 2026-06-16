/**
 * FakeRawCdp / FakeRawCdpSource — emulate a raw Playwright CDPSession and an
 * active-target source so the CDP adapter (CDP-1/2/3) is unit-testable without
 * a real browser. Supports swapping the active target (CDP-2: navigation /
 * new-tab follow).
 */
import type { RawCdp, RawCdpSource } from '../../src/core/cdp-playwright.js';

export class FakeRawCdp implements RawCdp {
  readonly sent: { method: string; params?: any }[] = [];
  private handlers = new Map<string, Set<(p: any) => void>>();
  constructor(public readonly label: string) {}
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.sent.push({ method, params });
    return {};
  }
  on(event: string, handler: (p: any) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  off(event: string, handler: (p: any) => void): void {
    this.handlers.get(event)?.delete(handler);
  }
  fire(event: string, params: any): void {
    for (const h of [...(this.handlers.get(event) ?? [])]) h(params);
  }
  callsTo(method: string) {
    return this.sent.filter((s) => s.method === method);
  }
}

export class FakeRawCdpSource implements RawCdpSource {
  private targetChange = new Set<() => void>();
  constructor(public active: FakeRawCdp) {}
  current(): RawCdp {
    return this.active;
  }
  onTargetChange(handler: () => void): void {
    this.targetChange.add(handler);
  }
  /** Simulate a new-tab / cross-document nav switching the active target. */
  switchTo(next: FakeRawCdp): void {
    this.active = next;
    for (const h of [...this.targetChange]) h();
  }
}
