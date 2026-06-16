/**
 * INP-1/3/5/6 — pure coordinate + key mapping. RED until input-mapper is built.
 */
import { describe, expect, it } from 'vitest';
import { keyEventToCdp, mapPointerToPage, mouseEventToCdp } from '../../src/core/input-mapper.js';

describe('input-mapper', () => {
  it('INP-3: maps client coords to page coords under uniform downscale', () => {
    // Canvas frame is 1280x800 but displayed at 640x400 (0.5x). A click at the
    // display center (320,200) maps to page center (640,400).
    const p = mapPointerToPage({
      clientX: 320, clientY: 200,
      rect: { left: 0, top: 0, width: 640, height: 400 },
      frame: { width: 1280, height: 800 },
    });
    expect(p).toEqual({ x: 640, y: 400 });
  });

  it('INP-3: accounts for rect offset (panel not at viewport origin)', () => {
    const p = mapPointerToPage({
      clientX: 100, clientY: 50,
      rect: { left: 100, top: 50, width: 1280, height: 800 },
      frame: { width: 1280, height: 800 },
    });
    expect(p).toEqual({ x: 0, y: 0 });
  });

  it('INP-3: returns null for clicks in the letterbox margin (fit:contain)', () => {
    // Element 800x800, frame 1280x800 (wide) → contain leaves top/bottom bars.
    const p = mapPointerToPage({
      clientX: 400, clientY: 10, // top margin
      rect: { left: 0, top: 0, width: 800, height: 800 },
      frame: { width: 1280, height: 800 },
      fit: 'contain',
    });
    expect(p).toBeNull();
  });

  it('INP-1: maps a left press to dispatchMouseEvent params', () => {
    expect(mouseEventToCdp({ kind: 'mouse', type: 'mousePressed', x: 12, y: 34, button: 'left', clickCount: 1 }))
      .toMatchObject({ type: 'mousePressed', x: 12, y: 34, button: 'left', clickCount: 1 });
  });

  it('INP-1: wheel carries deltas', () => {
    expect(mouseEventToCdp({ kind: 'mouse', type: 'mouseWheel', x: 5, y: 5, deltaX: 0, deltaY: 120 }))
      .toMatchObject({ type: 'mouseWheel', deltaY: 120 });
  });

  it('INP-5: shift modifier sets bit 8 and printable text', () => {
    const ev = keyEventToCdp({ kind: 'key', type: 'keyDown', key: 'A', code: 'KeyA', modifiers: { shift: true } });
    expect(ev.modifiers & 8).toBe(8);
    expect(ev.text).toBe('A');
  });

  it('INP-6: Enter is a non-text special key with a virtual key code', () => {
    const ev = keyEventToCdp({ kind: 'key', type: 'keyDown', key: 'Enter', code: 'Enter' });
    expect(ev.key).toBe('Enter');
    expect(ev.text).toBeUndefined();
    expect(ev.windowsVirtualKeyCode).toBe(13);
  });

  it('INP-6: Backspace carries its virtual key code (so Chrome performs the delete)', () => {
    const ev = keyEventToCdp({ kind: 'key', type: 'keyDown', key: 'Backspace', code: 'Backspace' });
    expect(ev.windowsVirtualKeyCode).toBe(8);
    expect(ev.text).toBeUndefined();
  });

  it('INP-5: printable letters carry both text and a VK code', () => {
    const ev = keyEventToCdp({ kind: 'key', type: 'keyDown', key: 'a', code: 'KeyA' });
    expect(ev.text).toBe('a');
    expect(ev.windowsVirtualKeyCode).toBe(65);
  });
});
