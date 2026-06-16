/**
 * Backpressure / coalescing utilities (PERF-1/2, RES-5). Pure + injectable so
 * they're deterministic under tests.
 */

/**
 * Latest-wins frame pacer with a bounded queue of ONE (PERF-1, RES-5). While a
 * frame is "in flight" (not yet drained), newer frames replace the pending one
 * instead of queuing — so a slow consumer never grows an unbounded backlog and
 * always converges to the most recent frame.
 */
export function createFramePacer<T>(send: (frame: T) => void) {
  let inFlight = false;
  let pending: { frame: T } | null = null;
  let dropped = 0;

  return {
    /** Offer a frame; sends immediately if idle, else coalesces to latest. */
    offer(frame: T): void {
      if (!inFlight) {
        inFlight = true;
        send(frame);
      } else {
        if (pending) dropped += 1; // replacing an un-drained frame
        pending = { frame };
      }
    },
    /** Mark the in-flight frame drained; flush the latest pending one (if any). */
    drain(): void {
      if (pending) {
        const next = pending.frame;
        pending = null;
        send(next); // stays inFlight
      } else {
        inFlight = false;
      }
    },
    /** Frames coalesced away (never more than `queued` outstanding). */
    get droppedCount(): number { return dropped; },
    get queued(): number { return pending ? 1 : 0; },
  };
}

export interface InputCoalescerOptions {
  /** Schedule a flush; returns a cancel handle. Injected for deterministic tests. */
  schedule(cb: () => void): unknown;
  cancel(handle: unknown): void;
}

/**
 * Coalesces high-frequency pointer moves to at most ONE per scheduler tick
 * (PERF-2). Non-move events flush any pending move first, then send immediately,
 * preserving causal order (a click always lands after the move that positioned it).
 */
export function createInputCoalescer(
  send: (event: Record<string, unknown>) => void,
  opts: InputCoalescerOptions,
) {
  let pendingMove: Record<string, unknown> | null = null;
  let handle: unknown = null;

  const flush = () => {
    handle = null;
    if (pendingMove) {
      const m = pendingMove;
      pendingMove = null;
      send(m);
    }
  };

  const isMove = (e: Record<string, unknown>) => e.kind === 'mouse' && e.type === 'mouseMoved';

  return {
    push(event: Record<string, unknown>): void {
      if (isMove(event)) {
        pendingMove = event;
        if (handle === null) handle = opts.schedule(flush);
        return;
      }
      // Non-move: flush the latest move first (order), then send now.
      if (handle !== null) { opts.cancel(handle); handle = null; }
      if (pendingMove) { const m = pendingMove; pendingMove = null; send(m); }
      send(event);
    },
  };
}
