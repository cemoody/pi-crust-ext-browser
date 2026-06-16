/**
 * Real CDP adapter (CDP-1..4): wraps a Playwright CDPSession + page into the
 * `CdpSession` the (tested) BrowserService depends on, and a `CdpFactory` that
 * either connects to a configured CDP endpoint or launches a headful Chromium.
 *
 * Modeled behind a `RawCdp` interface so the navigation/target-follow logic
 * (CDP-2 — the bug the prototype had) is unit testable without a real browser.
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

/**
 * Wrap a raw CDP source into a stable CdpSession that follows the active page.
 *
 * Strategy: we own the subscriptions. For each `on(event, handler)` the caller
 * registers, we attach a single forwarding listener to the *current* raw
 * target. When the active target switches, we detach from the old target,
 * re-attach all forwarders to the new one, and re-issue any commands that must
 * be re-established on a fresh target — chiefly `Page.startScreencast`, so the
 * stream follows navigations/new tabs (CDP-2).
 */
export function createCdpAdapter(source: RawCdpSource): CdpSession {
  // event -> set of caller handlers
  const subscribers = new Map<string, Set<(p: any) => void>>();
  // event -> the single forwarder we attached to the current raw target
  let forwarders = new Map<string, (p: any) => void>();
  let active: RawCdp = source.current();
  // Last screencast args, so we can re-establish the stream on a new target.
  let screencastArgs: Record<string, unknown> | undefined;

  const attachForwarders = (raw: RawCdp): void => {
    forwarders = new Map();
    for (const event of subscribers.keys()) {
      const fwd = (p: any) => {
        for (const h of [...(subscribers.get(event) ?? [])]) h(p);
      };
      forwarders.set(event, fwd);
      raw.on(event, fwd);
    }
  };

  const detachForwarders = (raw: RawCdp): void => {
    for (const [event, fwd] of forwarders) raw.off(event, fwd);
    forwarders = new Map();
  };

  // Bind forwarders to the initial target.
  attachForwarders(active);

  source.onTargetChange(() => {
    const next = source.current();
    if (next === active) return;
    detachForwarders(active);
    active = next;
    attachForwarders(active);
    // Re-establish the screencast on the new target so frames keep flowing.
    if (screencastArgs) void active.send('Page.startScreencast', screencastArgs);
  });

  return {
    async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
      if (method === 'Page.startScreencast') screencastArgs = params ?? {};
      else if (method === 'Page.stopScreencast') screencastArgs = undefined;
      return active.send(method, params);
    },
    on(event: string, handler: (p: any) => void): void {
      let set = subscribers.get(event);
      if (!set) {
        set = new Set();
        subscribers.set(event, set);
        // First subscriber for this event → attach a forwarder to the active target.
        const fwd = (p: any) => {
          for (const h of [...(subscribers.get(event) ?? [])]) h(p);
        };
        forwarders.set(event, fwd);
        active.on(event, fwd);
      }
      set.add(handler);
    },
    off(event: string, handler: (p: any) => void): void {
      subscribers.get(event)?.delete(handler);
    },
  };
}

export interface PlaywrightCdpFactoryOptions {
  /** Connect to an existing CDP endpoint (the "remote box"). */
  readonly cdpUrl?: string;
  /** Otherwise launch a (headful, Xvfb) Chromium. */
  readonly launch?: { headless?: boolean };
}

/**
 * A CdpFactory backed by Playwright connectOverCDP / launch (CDP-4).
 *
 * Lazily imports playwright so the core has no hard dependency when only the
 * unit layer (FakeCdpSession / FakeRawCdp) runs. Builds a RawCdpSource that
 * tracks the active page (so createCdpAdapter can follow navigations/new tabs),
 * then adapts it.
 */
export function createPlaywrightCdpFactory(opts: PlaywrightCdpFactoryOptions): CdpFactory {
  return {
    async create(_piSessionId: string) {
      // Lazy import keeps playwright optional for unit tests.
      const { chromium } = (await import('playwright')) as typeof import('playwright');
      const browser = opts.cdpUrl
        ? await chromium.connectOverCDP(opts.cdpUrl)
        : await chromium.launch({ headless: opts.launch?.headless ?? false });

      const context = browser.contexts()[0] ?? (await browser.newContext());
      const ensurePage = async () => context.pages()[0] ?? (await context.newPage());
      let page = await ensurePage();

      // Track the active page; switch to a newly-opened page (CDP-2 new tab).
      const targetHandlers = new Set<() => void>();
      let raw = await context.newCDPSession(page);
      context.on('page', async (p) => {
        page = p;
        raw = await context.newCDPSession(page);
        for (const h of [...targetHandlers]) h();
      });
      page.on('close', async () => {
        const next = await ensurePage();
        page = next;
        raw = await context.newCDPSession(page);
        for (const h of [...targetHandlers]) h();
      });

      const source: RawCdpSource = {
        current: () => raw as unknown as RawCdp,
        onTargetChange: (h) => targetHandlers.add(h),
      };

      return {
        session: createCdpAdapter(source),
        close: async () => {
          try {
            await browser.close();
          } catch {
            /* ignore */
          }
        },
      };
    },
  } satisfies CdpFactory;
}
