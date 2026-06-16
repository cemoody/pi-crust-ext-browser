/**
 * Golden e2e (real Chromium via CDP). Excluded from the fast suite (see
 * vitest.config exclude); run with the browser-enabled job. Asserts the loop
 * via STATE ROUND-TRIPS, not pixel diffs (the prototype, formalized).
 */
import { describe, it } from 'vitest';

describe('golden e2e (real browser)', () => {
  it.todo('E/B: page.goto(loginUrl) → viewer receives a frame seq>prev AND meta.url===loginUrl');
  it.todo('E/INP-4: viewer sends mouse+key for the password → remote inputValue(#password) matches');
  it.todo('E/HOFF-3: POST /resume → a pending browser_wait_for_human() resolves');
  it.todo('E/LIFE-3: closing the pi session exits the child Chromium pid (no orphan)');
  it.todo('E/LIFE-2: the browser cannot read files outside the session sandbox');
  it.todo('E/RVL-3: Tier-B sandbox="allow-scripts" iframe opens its WebSocket and renders frames');
  it.todo('E/visual-smoke (soft): one decoded frame on a known page is non-blank (region hash)');
  it.todo('E/headful: the whole suite also passes under Xvfb (headful Chromium)');
});
