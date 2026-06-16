/**
 * PERF-1/2, RES-5 — frame pacing + input coalescing. RED until pacing is built.
 */
import { describe, expect, it } from 'vitest';
import { createFramePacer, createInputCoalescer, createQualityController } from '../../src/core/pacing.js';

describe('frame pacer (PERF-1 / RES-5)', () => {
  it('sends the first frame immediately', () => {
    const out: number[] = [];
    const p = createFramePacer<number>((f) => out.push(f));
    p.offer(1);
    expect(out).toEqual([1]);
  });

  it('RES-5: while in-flight, coalesces to the LATEST frame (bounded queue of 1)', () => {
    const out: number[] = [];
    const p = createFramePacer<number>((f) => out.push(f));
    p.offer(1);          // sent
    p.offer(2); p.offer(3); p.offer(4); // queued → collapse to latest (4)
    expect(p.queued).toBe(1);
    expect(p.droppedCount).toBe(2); // 2 and 3 dropped
    p.drain();           // flush latest
    expect(out).toEqual([1, 4]);
  });

  it('PERF-1: queue never exceeds 1 regardless of burst size', () => {
    const p = createFramePacer<number>(() => {});
    p.offer(0);
    for (let i = 1; i <= 1000; i++) p.offer(i);
    expect(p.queued).toBeLessThanOrEqual(1);
  });

  it('drain with nothing pending goes idle (next offer sends immediately)', () => {
    const out: number[] = [];
    const p = createFramePacer<number>((f) => out.push(f));
    p.offer(1); p.drain();
    p.offer(2);
    expect(out).toEqual([1, 2]);
  });
});

describe('adaptive quality controller', () => {
  it('lowers quality under sustained high round-trip', () => {
    const c = createQualityController({ startQuality: 75 });
    let last = c.quality;
    for (let i = 0; i < 10; i++) { const q = c.sample(800); if (q !== null) last = q; }
    expect(last).toBeLessThanOrEqual(45);
    expect(c.quality).toBeLessThanOrEqual(45);
  });

  it('raises quality under sustained low round-trip', () => {
    const c = createQualityController({ startQuality: 45 });
    let last = c.quality;
    for (let i = 0; i < 12; i++) { const q = c.sample(20); if (q !== null) last = q; }
    expect(c.quality).toBeGreaterThanOrEqual(72);
  });

  it('does not thrash on a single outlier (hysteresis)', () => {
    const c = createQualityController({ startQuality: 75 });
    // one slow sample shouldn\'t immediately drop the band
    expect(c.sample(800)).toBeNull();
  });
});

describe('input coalescer (PERF-2)', () => {
  function manualScheduler() {
    const cbs: (() => void)[] = [];
    return {
      opts: { schedule: (cb: () => void) => { cbs.push(cb); return cbs.length - 1; }, cancel: () => {} },
      tick: () => { const c = cbs.splice(0); for (const cb of c) cb(); },
    };
  }

  it('PERF-2: a burst of mousemove collapses to one send per tick (the latest)', () => {
    const sent: any[] = [];
    const sch = manualScheduler();
    const c = createInputCoalescer((e) => sent.push(e), sch.opts);
    c.push({ kind: 'mouse', type: 'mouseMoved', x: 1, y: 1 });
    c.push({ kind: 'mouse', type: 'mouseMoved', x: 2, y: 2 });
    c.push({ kind: 'mouse', type: 'mouseMoved', x: 3, y: 3 });
    expect(sent).toHaveLength(0); // nothing sent until the tick
    sch.tick();
    expect(sent).toEqual([{ kind: 'mouse', type: 'mouseMoved', x: 3, y: 3 }]);
  });

  it('PERF-2: a click flushes the pending move first, then sends (causal order)', () => {
    const sent: any[] = [];
    const sch = manualScheduler();
    const c = createInputCoalescer((e) => sent.push(e), sch.opts);
    c.push({ kind: 'mouse', type: 'mouseMoved', x: 9, y: 9 });
    c.push({ kind: 'mouse', type: 'mousePressed', x: 9, y: 9, button: 'left' });
    expect(sent.map((e) => e.type)).toEqual(['mouseMoved', 'mousePressed']);
  });
});
