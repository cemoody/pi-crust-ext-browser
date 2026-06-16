/**
 * BrowserService — server-owned remote-browser manager.
 *
 * Responsibilities (all unit-testable against a FakeCdpSession):
 *  - session lifecycle + reuse (LIFE-*)
 *  - screencast start/stop tied to viewer presence (STR-1/2/3)
 *  - frame fan-out with monotonic seq + ack pacing (STR-4/6, MUX-1/2)
 *  - input replay with per-viewer ownership (INP-*, SEC-1)
 *  - human-handoff state machine (HOFF-*)
 */
import { keyEventToCdp, mouseEventToCdp } from './input-mapper.js';
import type {
  BrowserService,
  BrowserServiceOptions,
  CdpSession,
  InputEvent,
  MetaEnvelope,
  Viewer,
} from './protocol.js';
import { BrowserError } from './protocol.js';

/** Sentinel viewerId for the LLM driver path (gated while awaiting human). */
const LLM_VIEWER = '__llm__';

interface Waiter {
  resolve: (r: { resumed: boolean }) => void;
  reject: (e: BrowserError) => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface SessionState {
  browserId: string;
  piSessionId: string;
  cdp: CdpSession;
  close: () => Promise<void>;
  viewers: Map<string, Viewer>;
  screencasting: boolean;
  seq: number;
  awaitingHuman: boolean;
  reason?: string;
  waiters: Waiter[];
  onFrame?: (p: any) => void;
  onNav?: (p: any) => void;
  onCrash?: (p: any) => void;
  lastActivity: number;
  lastMobile?: boolean;
}

export function createBrowserService(options: BrowserServiceOptions): BrowserService {
  const { cdpFactory } = options;
  const quality = options.jpegQuality ?? 60;
  const maxWidth = options.maxWidth ?? 1280;
  const maxSessions = options.maxSessions ?? Infinity;
  const idleMs = options.idleMs ?? 5 * 60 * 1000;
  const reapIntervalMs = options.reapIntervalMs ?? 30 * 1000;
  const homeUrl = options.homeUrl;
  const now = options.now ?? Date.now;

  const byBrowserId = new Map<string, SessionState>();
  const browserIdByPi = new Map<string, string>();
  let nextId = 1;

  const touch = (s: SessionState): void => { s.lastActivity = now(); };

  const require = (browserId: string): SessionState => {
    const s = byBrowserId.get(browserId);
    if (!s) throw new BrowserError('NO_SESSION', `unknown browserId: ${browserId}`);
    return s;
  };

  const fanMeta = (s: SessionState, meta: Omit<MetaEnvelope, 'browserId'>): void => {
    const full: MetaEnvelope = { browserId: s.browserId, ...meta };
    for (const v of [...s.viewers.values()]) v.onMeta(full);
  };

  const startScreencast = async (s: SessionState): Promise<void> => {
    if (s.screencasting) return;
    s.screencasting = true;
    s.seq = 0;

    s.onFrame = (p: any) => {
      // Ack immediately so Chromium keeps sending (STR-6 backpressure pacing).
      // Swallow post-close rejections (the socket may drop mid-frame).
      void s.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      s.seq += 1;
      const w = p?.metadata?.deviceWidth ?? maxWidth;
      const h = p?.metadata?.deviceHeight ?? 0;
      for (const v of [...s.viewers.values()]) {
        v.onFrame({ browserId: s.browserId, seq: s.seq, jpegB64: p.data, w, h });
      }
    };
    s.onNav = (p: any) => {
      const url = p?.frame?.url;
      if (typeof url === 'string') fanMeta(s, { url });
    };
    s.cdp.on('Page.screencastFrame', s.onFrame);
    s.cdp.on('Page.frameNavigated', s.onNav);
    // Enable the Page domain so frameNavigated events fire (meta url updates).
    await s.cdp.send('Page.enable');
    if (!s.onCrash) {
      // RES-3: surface a target/page crash to viewers, then stop the stream.
      s.onCrash = () => {
        fanMeta(s, { closed: true, reason: 'browser target crashed' });
        void stopScreencast(s);
      };
      s.cdp.on('Target.crashed', s.onCrash);
      s.cdp.on('Inspector.targetCrashed', s.onCrash);
    }
    await s.cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth });
  };

  const stopScreencast = async (s: SessionState): Promise<void> => {
    if (!s.screencasting) return;
    s.screencasting = false;
    if (s.onFrame) s.cdp.off('Page.screencastFrame', s.onFrame);
    if (s.onNav) s.cdp.off('Page.frameNavigated', s.onNav);
    s.onFrame = undefined;
    s.onNav = undefined;
    await s.cdp.send('Page.stopScreencast');
  };

  const clearAwaiting = (s: SessionState): void => {
    s.awaitingHuman = false;
    s.reason = undefined;
    for (const w of s.waiters) if (w.timer) clearTimeout(w.timer);
  };

  const dispatch = async (s: SessionState, event: InputEvent): Promise<void> => {
    touch(s);
    if (event.kind === 'mouse') {
      await s.cdp.send('Input.dispatchMouseEvent', mouseEventToCdp(event) as any);
    } else if (event.kind === 'key') {
      await s.cdp.send('Input.dispatchKeyEvent', keyEventToCdp(event) as any);
    } else {
      await s.cdp.send('Input.insertText', { text: event.text });
    }
  };

  // Tear down one browser fully (used by closeSession + the idle reaper).
  const closeState = async (s: SessionState): Promise<void> => {
    await stopScreencast(s).catch(() => {});
    for (const w of s.waiters) { if (w.timer) clearTimeout(w.timer); w.reject(new BrowserError('BROWSER_CLOSED', 'browser closed')); }
    s.waiters = [];
    byBrowserId.delete(s.browserId);
    browserIdByPi.delete(s.piSessionId);
    await s.close().catch(() => {});
  };

  // LIFE-5: reap browsers with no viewers + no activity (and not awaiting a
  // human) so we never leak Chromiums/CDP connections across sessions.
  let reaper: ReturnType<typeof setInterval> | undefined;
  if (idleMs > 0) {
    reaper = setInterval(() => {
      const cutoff = now() - idleMs;
      for (const s of [...byBrowserId.values()]) {
        if (s.viewers.size === 0 && !s.awaitingHuman && s.lastActivity < cutoff) {
          void closeState(s);
        }
      }
    }, reapIntervalMs);
    // Don't keep the process alive just for the reaper.
    (reaper as any).unref?.();
  }

  return {
    async openSession(piSessionId: string): Promise<string> {
      const existing = browserIdByPi.get(piSessionId);
      if (existing) return existing; // LIFE-1/8: reuse
      if (byBrowserId.size >= maxSessions) {
        throw new BrowserError('TOO_MANY_SESSIONS', `max ${maxSessions} browser sessions`);
      }
      const { session, close } = await cdpFactory.create(piSessionId);
      const browserId = `br-${nextId++}`;
      byBrowserId.set(browserId, {
        browserId,
        piSessionId,
        cdp: session,
        close,
        viewers: new Map(),
        screencasting: false,
        seq: 0,
        awaitingHuman: false,
        waiters: [],
        lastActivity: now(),
      });
      browserIdByPi.set(piSessionId, browserId);
      // New browser opens on the configured home page (e.g. google.com) so the
      // panel shows something instead of about:blank.
      if (homeUrl) void session.send('Page.navigate', { url: homeUrl }).catch(() => {});
      return browserId;
    },

    async attach(browserId: string, viewer: Viewer): Promise<void> {
      const s = require(browserId); // ERR-1
      if (s.viewers.has(viewer.id)) return; // ERR-2: idempotent
      s.viewers.set(viewer.id, viewer);
      touch(s);
      await startScreencast(s); // STR-1 (first attach only)
    },

    async detach(browserId: string, viewerId: string): Promise<void> {
      const s = require(browserId);
      s.viewers.delete(viewerId);
      if (s.viewers.size === 0) await stopScreencast(s); // STR-3
    },

    async input(browserId: string, viewerId: string, event: InputEvent): Promise<void> {
      const s = require(browserId);
      if (viewerId === LLM_VIEWER) {
        if (s.awaitingHuman) throw new BrowserError('AWAITING_HUMAN', 'human handoff in progress'); // HOFF-7
        await dispatch(s, event);
        return;
      }
      if (!s.viewers.has(viewerId)) throw new BrowserError('NOT_OWNER', 'viewer has not attached'); // SEC-1
      await dispatch(s, event);
    },

    async navigate(browserId: string, url: string): Promise<void> {
      const s = require(browserId);
      touch(s);
      await s.cdp.send('Page.navigate', { url });
    },

    async setViewport(browserId, vp): Promise<void> {
      const s = require(browserId);
      touch(s);
      const width = Math.max(1, Math.round(vp.width));
      const height = Math.max(1, Math.round(vp.height));
      const deviceScaleFactor = vp.deviceScaleFactor && vp.deviceScaleFactor > 0 ? vp.deviceScaleFactor : 1;
      const mobile = !!vp.mobile;
      await s.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });
      // Touch emulation so mobile sites use tap/scroll behavior.
      await s.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 0 }).catch(() => {});
      // UA-sniffing sites (e.g. google.com) only serve their mobile layout for a
      // mobile UA at load. Set a matching UA and reload once when the mobile
      // state flips, so the page re-renders in the right layout (not a squished
      // desktop page). Resizes that don't change the mode never reload.
      if (mobile !== s.lastMobile) {
        s.lastMobile = mobile;
        if (mobile) {
          await s.cdp.send('Emulation.setUserAgentOverride', {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            platform: 'iPhone',
          }).catch(() => {});
        } else {
          await s.cdp.send('Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => {});
        }
        await s.cdp.send('Page.reload', {}).catch(() => {});
      }
    },

    async reload(browserId: string): Promise<void> {
      const s = require(browserId);
      touch(s);
      await s.cdp.send('Page.reload', {});
    },

    async goBack(browserId: string): Promise<void> {
      const s = require(browserId);
      touch(s);
      const h = (await s.cdp.send('Page.getNavigationHistory')) as any;
      const entries = Array.isArray(h?.entries) ? h.entries : [];
      const idx = (typeof h?.currentIndex === 'number' ? h.currentIndex : 0) - 1;
      if (idx >= 0 && entries[idx]) await s.cdp.send('Page.navigateToHistoryEntry', { entryId: entries[idx].id });
    },

    async snapshot(browserId: string): Promise<{ url: string; title: string; text: string }> {
      const s = require(browserId);
      // innerText excludes <input> values, so passwords never appear (SEC-3).
      const expr =
        '({url:location.href,title:document.title,text:(document.body?document.body.innerText:"").slice(0,20000)})';
      const res = (await s.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })) as any;
      const v = res?.result?.value ?? {};
      return { url: String(v.url ?? ''), title: String(v.title ?? ''), text: String(v.text ?? '') };
    },

    requestLogin(browserId: string, reason: string): void {
      const s = require(browserId);
      touch(s);
      s.awaitingHuman = true; // HOFF-1
      s.reason = reason;
      fanMeta(s, { awaitingHuman: true, reason });
    },

    waitForHuman(browserId: string, opts?: { timeoutMs?: number }): Promise<{ resumed: boolean }> {
      const s = require(browserId);
      return new Promise((resolve, reject) => {
        const waiter: Waiter = { resolve, reject };
        if (opts?.timeoutMs !== undefined) {
          waiter.timer = setTimeout(() => {
            s.waiters = s.waiters.filter((w) => w !== waiter);
            clearAwaiting(s); // HOFF-4
            reject(new BrowserError('HUMAN_TIMEOUT', 'no human response in time'));
          }, opts.timeoutMs);
        }
        s.waiters.push(waiter);
      });
    },

    resume(browserId: string): { resumed: boolean } {
      const s = require(browserId);
      if (!s.awaitingHuman) return { resumed: false }; // HOFF-8
      const waiters = s.waiters;
      s.waiters = [];
      clearAwaiting(s);
      for (const w of waiters) w.resolve({ resumed: true }); // HOFF-3
      fanMeta(s, { awaitingHuman: false });
      return { resumed: true };
    },

    cancel(browserId: string): void {
      const s = require(browserId);
      const waiters = s.waiters;
      s.waiters = [];
      clearAwaiting(s);
      for (const w of waiters) w.reject(new BrowserError('HUMAN_CANCELLED', 'human handoff cancelled')); // HOFF-5
      fanMeta(s, { awaitingHuman: false });
    },

    async closeSession(piSessionId: string): Promise<void> {
      const browserId = browserIdByPi.get(piSessionId);
      if (!browserId) return;
      const s = byBrowserId.get(browserId);
      if (s) await closeState(s); // LIFE-3: dispose underlying browser
    },

    hasSession(piSessionId: string): boolean {
      return browserIdByPi.has(piSessionId);
    },

    async dispose(): Promise<void> {
      if (reaper) clearInterval(reaper);
      for (const s of [...byBrowserId.values()]) await closeState(s);
    },

    isScreencasting(browserId: string): boolean {
      return byBrowserId.get(browserId)?.screencasting ?? false;
    },
    isAwaitingHuman(browserId: string): boolean {
      return byBrowserId.get(browserId)?.awaitingHuman ?? false;
    },
  };
}
