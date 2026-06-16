/**
 * Web widget (canvas viewer) — jsdom + mocked canvas/Image + FakeSocket.
 * Scaffolded as todo: needs the jsdom/RTL widget harness.
 */
import { describe, it } from 'vitest';

describe('widget (DOM)', () => {
  it.todo('W/STR-1: draws on browser:frame (drawImage called with decoded frame)');
  it.todo('W/STR-10: shows loading indicator until first frame, then clears it');
  it.todo('W/INP-2: canvas click emits browser:input mouse with mapped page coords');
  it.todo('W/INP-4: keydown on focused canvas emits browser:input key with text');
  it.todo('W/INP-10: clicking canvas focuses it; blur stops key capture');
  it.todo('W/HOFF-6: awaitingHuman renders the "Agent is waiting — sign in" banner + Resume/Cancel');
  it.todo('W/RVL-2: mounting attaches; unmounting detaches (no stream when hidden)');
  it.todo('W/RVL-6: maximize → full-viewport overlay; Esc restores; canvas refits');
  it.todo('W/RVL-8: with no Tier-C reveal API present, no thrown errors / dead buttons');
  it.todo('W/ERR-5: a corrupt frame is skipped without throwing; stream continues');
  it.todo('A11Y-1: canvas is keyboard-focusable with a visible focus ring + ARIA label');
});
