/**
 * HOFF-* — human handoff / login state machine. RED until built.
 */
import { describe, expect, it, vi } from 'vitest';
import { createBrowserService } from '../../src/core/browser-service.js';
import { FakeCdpFactory, RecordingViewer } from '../helpers/fake-cdp-session.js';

async function withSession() {
  const cdpFactory = new FakeCdpFactory();
  const service = createBrowserService({ cdpFactory });
  const id = await service.openSession('pi-1');
  const viewer = new RecordingViewer('v1');
  await service.attach(id, viewer);
  return { service, id, viewer, cdpFactory };
}

describe('handoff', () => {
  it('HOFF-1: requestLogin sets awaitingHuman and emits meta with reason', async () => {
    const { service, id, viewer } = await withSession();
    service.requestLogin(id, 'GitHub needs your password');
    expect(service.isAwaitingHuman(id)).toBe(true);
    expect(viewer.metas.some((m) => m.awaitingHuman === true && m.reason?.includes('GitHub'))).toBe(true);
  });

  it('HOFF-3: waitForHuman resolves after resume', async () => {
    const { service, id } = await withSession();
    service.requestLogin(id, 'sign in');
    const waiting = service.waitForHuman(id, { timeoutMs: 1000 });
    const r = service.resume(id);
    expect(r).toEqual({ resumed: true });
    await expect(waiting).resolves.toEqual({ resumed: true });
    expect(service.isAwaitingHuman(id)).toBe(false);
  });

  it('HOFF-4: waitForHuman rejects HUMAN_TIMEOUT and clears awaiting', async () => {
    vi.useFakeTimers();
    const { service, id } = await withSession();
    service.requestLogin(id, 'sign in');
    const waiting = service.waitForHuman(id, { timeoutMs: 50 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(60);
    const err = await waiting;
    expect(err).toMatchObject({ code: 'HUMAN_TIMEOUT' });
    expect(service.isAwaitingHuman(id)).toBe(false);
    vi.useRealTimers();
  });

  it('HOFF-5: cancel rejects the pending wait with HUMAN_CANCELLED', async () => {
    const { service, id } = await withSession();
    service.requestLogin(id, 'sign in');
    const waiting = service.waitForHuman(id, { timeoutMs: 1000 }).catch((e) => e);
    service.cancel(id);
    expect(await waiting).toMatchObject({ code: 'HUMAN_CANCELLED' });
  });

  it('HOFF-7: LLM input is rejected with AWAITING_HUMAN while awaiting (driver lock)', async () => {
    const { service, id } = await withSession();
    service.requestLogin(id, 'sign in');
    // The LLM path (act/navigate) is gated; modeled here as a service guard.
    await expect(service.input(id, '__llm__', { kind: 'text', text: 'typed by llm' }))
      .rejects.toMatchObject({ code: 'AWAITING_HUMAN' });
  });

  it('HOFF-8: resume when not awaiting is a no-op (idempotent)', async () => {
    const { service, id } = await withSession();
    expect(service.resume(id)).toEqual({ resumed: false });
  });
});
