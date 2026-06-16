/**
 * W-GW — widget rides the shared gateway, not a hardcoded WebSocket. jsdom +
 * a fake socket. Scaffolded as todo until the widget transport is swapped from
 * the prototype's `new WebSocket('ws://…:4000')` to browser:* on the host socket.
 */
import { describe, it } from 'vitest';

describe('widget transport (gateway)', () => {
  it.todo('W-GW/DEPLOY-1: widget connects to same-origin /socket.io/, no hardcoded host/port');
  it.todo('W-GW: widget emits browser:attach {sessionId, token} and renders browser:frame');
  it.todo('W-GW: canvas input is sent as browser:input over the shared socket');
  it.todo('W-GW/RES-1: transport drop → reconnect re-attaches and resumes frames');
  it.todo('W-GW/RVL-2: unmounting the widget emits browser:detach (stop streaming when hidden)');
  it.todo('DEPLOY-2: the sandboxed inline card (allow-scripts) connects with its session token and streams');
});
