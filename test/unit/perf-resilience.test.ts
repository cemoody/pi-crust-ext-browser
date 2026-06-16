/**
 * PERF-* / RES-* — backpressure, coalescing, leak, recovery.
 * Scaffolded as todo: PERF needs a timing/queue harness; RES-3 crash uses e2e.
 */
import { describe, it } from 'vitest';

describe('perf & resilience', () => {
  it.todo('PERF-1: with CDP faster than acks, buffered bytes stay below cap; queue bounded');
  it.todo('PERF-2: a burst of mousemove collapses to <=1 dispatch per frame tick');
  it.todo('PERF-4: median JPEG frame under the byte cap at default quality/maxWidth');
  it.todo('PERF-5: 100 navigations + 50 attach/detach → screencast/listener counts return to baseline');
  it.todo('PERF-6: idle static page settles to <=1 fps / near-zero CPU (no busy loop)');
  it.todo('RES-2: mid-navigation disconnect → on reconnect shows current page, not stale frame');
  it.todo('RES-3: Target.crashed surfaces browser:meta{closed,reason} + recover affordance');
  it.todo('RES-5: wedged viewer drops to latest-frame-only; never unbounded queue');
  it.todo('LIFE-6: Chromium crash → next tool call returns BROWSER_CRASHED; retry relaunches');
});
