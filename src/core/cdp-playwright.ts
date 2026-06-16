/**
 * Real CDP adapter (CDP-1..4): wraps a Playwright CDPSession + page into the
 * `CdpSession` the (tested) BrowserService depends on, and a `CdpFactory` that
 * either connects to a configured CDP endpoint or launches a headful Chromium.
 *
 * The core was only tested against a FakeCdpSession; THIS is the untested seam
 * that talks to a real browser. Modeled behind a `RawCdp` interface so the
 * navigation/target-follow logic (CDP-2 — the bug the prototype had) is unit
 * testable without a real browser.
 *
 * STUBS — throw until implemented.
 */
import type { CdpFactory, CdpSession } from './protocol.js';

/** The minimal raw CDP surface (Playwright CDPSession satisfies this). */
export interface RawCdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: any) => void): void;
  off(event: string, handler: (params: any) => void): void;
}

/** Resolves the raw CDP session for the CURRENTLY active page/target. Lets the
 *  adapter re-bind when the page navigates cross-document or a new tab becomes
 *  active (CDP-2). */
export interface RawCdpSource {
  current(): RawCdp;
  /** Subscribe to active-target changes (new tab / cross-document nav). */
  onTargetChange(handler: () => void): void;
}

/** Wrap a raw CDP source into a stable CdpSession that follows the active page. */
export function createCdpAdapter(_source: RawCdpSource): CdpSession {
  throw new Error('NOT_IMPLEMENTED: createCdpAdapter (CDP-1/2/3)');
}

export interface PlaywrightCdpFactoryOptions {
  /** Connect to an existing CDP endpoint (the "remote box"). */
  readonly cdpUrl?: string;
  /** Otherwise launch a (headful, Xvfb) Chromium. */
  readonly launch?: { headless?: boolean };
}

/** A CdpFactory backed by Playwright connectOverCDP / launch (CDP-4). */
export function createPlaywrightCdpFactory(_opts: PlaywrightCdpFactoryOptions): CdpFactory {
  throw new Error('NOT_IMPLEMENTED: createPlaywrightCdpFactory (CDP-4)');
}
