/**
 * Wire + service types for pi-crust-ext-browser. Mirrors the terminal ext's
 * pty:* shape with browser:* semantics. Kept dependency-free so the core
 * service is unit-testable against a FakeCdpSession (no real browser).
 */

/** Minimal CDP session surface the service depends on (Playwright's CDPSession
 *  and a raw chrome-remote-interface both satisfy this). */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: any) => void): void;
  off(event: string, handler: (params: any) => void): void;
}

/** Opens/closes a CDP session bound to one pi session's browser. */
export interface CdpFactory {
  create(piSessionId: string): Promise<{ session: CdpSession; close(): Promise<void> }>;
}

export interface FrameEnvelope {
  readonly browserId: string;
  readonly seq: number;
  readonly jpegB64: string;
  readonly w: number;
  readonly h: number;
}

export interface MetaEnvelope {
  readonly browserId: string;
  readonly url?: string;
  readonly title?: string;
  readonly awaitingHuman?: boolean;
  readonly reason?: string;
  readonly closed?: boolean;
}

/** A connected client (sidebar panel or inline card). */
export interface Viewer {
  readonly id: string;
  onFrame(frame: FrameEnvelope): void;
  onMeta(meta: MetaEnvelope): void;
}

export type MouseInput = {
  kind: 'mouse';
  type: 'mouseMoved' | 'mousePressed' | 'mouseReleased' | 'mouseWheel';
  x: number;
  y: number;
  button?: 'none' | 'left' | 'middle' | 'right';
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
};
export type KeyInput = {
  kind: 'key';
  type: 'keyDown' | 'keyUp';
  key: string;
  code?: string;
  modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean };
};
export type TextInput = { kind: 'text'; text: string };
export type InputEvent = MouseInput | KeyInput | TextInput;

/** Typed errors so tools/clients can branch (TOOL-7, ERR-*, SEC-1). */
export class BrowserError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = 'BrowserError';
  }
}

export interface BrowserServiceOptions {
  readonly cdpFactory: CdpFactory;
  readonly maxSessions?: number;
  readonly jpegQuality?: number;
  readonly maxWidth?: number;
}

export interface BrowserService {
  /** LIFE-1/8: create or reuse the browser for a pi session. */
  openSession(piSessionId: string): Promise<string>;
  /** STR-1: attach a viewer; first attach starts the screencast. */
  attach(browserId: string, viewer: Viewer): Promise<void>;
  /** STR-3: detach a viewer; last detach stops the screencast. */
  detach(browserId: string, viewerId: string): Promise<void>;
  /** SEC-1: viewer must own (have attached) the browserId. */
  input(browserId: string, viewerId: string, event: InputEvent): Promise<void>;
  /** TOOL-2: navigate the browser (CDP Page.navigate). */
  navigate(browserId: string, url: string): Promise<void>;
  /** TOOL-4: model-safe page snapshot (url/title/text); never includes secrets. */
  snapshot(browserId: string): Promise<{ url: string; title: string; text: string }>;
  /** HOFF-1/2: enter awaiting-human state. */
  requestLogin(browserId: string, reason: string): void;
  /** HOFF-3/4/5: resolves on resume, rejects on timeout/cancel. */
  waitForHuman(browserId: string, opts?: { timeoutMs?: number }): Promise<{ resumed: boolean }>;
  /** HOFF-8: idempotent resume. */
  resume(browserId: string): { resumed: boolean };
  /** HOFF-5: cancel a pending handoff. */
  cancel(browserId: string): void;
  /** LIFE-3: dispose the browser for a pi session (no orphans). */
  closeSession(piSessionId: string): Promise<void>;

  // --- test/introspection seams ---
  isScreencasting(browserId: string): boolean;
  isAwaitingHuman(browserId: string): boolean;
}
