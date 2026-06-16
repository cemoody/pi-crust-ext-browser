/**
 * browser:* over the Socket.IO gateway — real socket.io-client ↔ real gateway,
 * fake CDP behind it. Mirrors tests/e2e/pty-realtime-contract.test.ts.
 * Scaffolded as todo: needs the extended realtime harness (withBrowser).
 */
import { describe, it } from 'vitest';

describe('browser:* realtime contract', () => {
  it.todo('C/STR-1: browser:attach ack returns { ok, browserId, viewport } and frames begin');
  it.todo('C/STR-3: browser:detach stops the stream for that socket only');
  it.todo('C/MUX-1: many viewers multiplex over ONE physical gateway connection');
  it.todo('C/MUX-2: zero cross-talk — session A frames never reach a B-only viewer');
  it.todo('C/SEC-1: input/detach with a foreign browserId → ack {ok:false}, socket stays connected');
  it.todo('C/ERR-1: attach to unknown pi session → ack {ok:false}, socket stays up');
  it.todo('C/ERR-3: oversized/malformed browser:* payload rejected; other sessions unaffected');
  it.todo('C/Invariant: session:subscribe + /api/* keep working alongside browser:* (coexistence)');
  it.todo('C/RES-1: reconnect resumes stream with no duplicate-delivery of acked content');
  it.todo('C/LIFE-4: disconnecting the last viewer does NOT kill a browser the LLM still holds');
});
