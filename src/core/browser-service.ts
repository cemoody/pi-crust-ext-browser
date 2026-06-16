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
}

export function createBrowserService(options: BrowserServiceOptions): BrowserService {
  const { cdpFactory } = options;
  const quality = options.jpegQuality ?? 60;
  const maxWidth = options.maxWidth ?? 1280;
  const maxSessions = options.maxSessions ?? Infinity;

  const byBrowserId = new Map<string, SessionState>();
  const browserIdByPi = new Map<string, string>();
  let nextId = 1;

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
    if (event.kind === 'mouse') {
      await s.cdp.send('Input.dispatchMouseEvent', mouseEventToCdp(event) as any);
    } else if (event.kind === 'key') {
      await s.cdp.send('Input.dispatchKeyEvent', keyEventToCdp(event) as any);
    } else {
      await s.cdp.send('Input.insertText', { text: event.text });
    }
  };

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
      });
      browserIdByPi.set(piSessionId, browserId);
      return browserId;
    },

    async attach(browserId: string, viewer: Viewer): Promise<void> {
      const s = require(browserId); // ERR-1
      if (s.viewers.has(viewer.id)) return; // ERR-2: idempotent
      s.viewers.set(viewer.id, viewer);
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
      await s.cdp.send('Page.navigate', { url });
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
      if (s) {
        await stopScreencast(s).catch(() => {});
        for (const w of s.waiters) if (w.timer) clearTimeout(w.timer);
        await s.close(); // LIFE-3: dispose underlying browser
      }
      byBrowserId.delete(browserId);
      browserIdByPi.delete(piSessionId);
    },

    isScreencasting(browserId: string): boolean {
      return byBrowserId.get(browserId)?.screencasting ?? false;
    },
    isAwaitingHuman(browserId: string): boolean {
      return byBrowserId.get(browserId)?.awaitingHuman ?? false;
    },
  };
}
