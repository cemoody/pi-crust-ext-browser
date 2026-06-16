/**
 * Pure coordinate + key mapping. The #1 source of "my click landed wrong" bugs,
 * so it lives behind pure functions with a table test (INP-1/3/5/6).
 */
import type { KeyInput, MouseInput } from './protocol.js';

export interface Rect { left: number; top: number; width: number; height: number }
export interface FrameSize { width: number; height: number }

/** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export interface CdpKeyEvent {
  type: 'keyDown' | 'keyUp' | 'rawKeyDown';
  key: string;
  code?: string;
  text?: string;
  windowsVirtualKeyCode?: number;
  nativeVirtualKeyCode?: number;
  modifiers: number;
}

export interface CdpMouseEvent {
  type: string;
  x: number;
  y: number;
  button: 'none' | 'left' | 'middle' | 'right';
  clickCount: number;
  deltaX?: number;
  deltaY?: number;
}

/**
 * Map a pointer event in CSS/client space to remote PAGE coordinates.
 * Handles uniform scaling and (with fit:'contain') letterbox margins; returns
 * null when the point falls in the letterbox margin (outside page content).
 */
export function mapPointerToPage(args: {
  clientX: number;
  clientY: number;
  rect: Rect;
  frame: FrameSize;
  fit?: 'fill' | 'contain';
}): { x: number; y: number } | null {
  const { clientX, clientY, rect, frame, fit = 'fill' } = args;

  // Content box within the element. For 'fill' it's the whole element; for
  // 'contain' it's the frame's aspect ratio scaled to fit, centered (letterbox).
  let contentLeft = rect.left;
  let contentTop = rect.top;
  let contentWidth = rect.width;
  let contentHeight = rect.height;

  if (fit === 'contain') {
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
    contentWidth = frame.width * scale;
    contentHeight = frame.height * scale;
    contentLeft = rect.left + (rect.width - contentWidth) / 2;
    contentTop = rect.top + (rect.height - contentHeight) / 2;
  }

  const dx = clientX - contentLeft;
  const dy = clientY - contentTop;
  // Outside the content box (letterbox margin or beyond) → no valid page point.
  if (dx < 0 || dy < 0 || dx > contentWidth || dy > contentHeight) return null;

  return {
    x: Math.round(dx * (frame.width / contentWidth)),
    y: Math.round(dy * (frame.height / contentHeight)),
  };
}

/** Map a viewer mouse input to a CDP Input.dispatchMouseEvent payload. */
export function mouseEventToCdp(input: MouseInput): CdpMouseEvent {
  return {
    type: input.type,
    x: input.x,
    y: input.y,
    button: input.button ?? 'none',
    clickCount: input.clickCount ?? 0,
    ...(input.deltaX !== undefined ? { deltaX: input.deltaX } : {}),
    ...(input.deltaY !== undefined ? { deltaY: input.deltaY } : {}),
  };
}

// Keys that carry text vs. keys that are non-text "named" keys.
const NAMED_KEYS = new Set([
  'Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Shift',
  'Control', 'Alt', 'Meta', 'CapsLock', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
  'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

function modifierMask(m?: KeyInput['modifiers']): number {
  if (!m) return 0;
  return (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
}

// Virtual key codes for non-text keys. Chrome only performs the *action* of
// keys like Backspace/Enter/Arrows/Tab when the event carries a virtual key
// code — `key`/`text` alone is not enough.
const VK: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27,
  ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Meta: 91,
};
function vkFor(key: string): number | undefined {
  if (VK[key] !== undefined) return VK[key];
  if (key.length === 1) {
    const c = key.toUpperCase().charCodeAt(0);
    if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57)) return c; // A-Z, 0-9
  }
  return undefined;
}

/** Map a viewer key input to a CDP Input.dispatchKeyEvent payload. */
export function keyEventToCdp(input: KeyInput): CdpKeyEvent {
  const isText = input.type === 'keyDown' && input.key.length === 1 && !NAMED_KEYS.has(input.key);
  // Enter needs text "\r" on keyDown so Chromium fires keypress + the default
  // action (e.g. implicit form submit); VK alone isn't enough.
  const text = isText ? input.key : (input.type === 'keyDown' && input.key === 'Enter' ? '\r' : undefined);
  const vk = vkFor(input.key);
  return {
    type: input.type,
    key: input.key,
    ...(input.code ? { code: input.code } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(vk !== undefined ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {}),
    modifiers: modifierMask(input.modifiers),
  };
}
