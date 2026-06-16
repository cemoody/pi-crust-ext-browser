/**
 * LLM tools (pi.extensions) — RPC to the server-owned browser. Scaffolded as
 * todo: needs the fake-pi + extension harness wired to a BrowserService.
 */
import { describe, it } from 'vitest';

describe('LLM tools', () => {
  it.todo('TOOL-1: each tool validates params; bad input → clear error, no side effects');
  it.todo('TOOL-2: browser_navigate returns {url,title,status}; invalid URL → NAV_INVALID_URL');
  it.todo('TOOL-3: browser_act click/fill/press/hover/scroll/waitFor; missing selector → SELECTOR_NOT_FOUND');
  it.todo('TOOL-4: browser_snapshot returns aria/DOM text sufficient to choose next action');
  it.todo('TOOL-5: browser_snapshot redacts input[type=password] (delegates to redactSnapshot)');
  it.todo('TOOL-6: tools are RPC to server; agent process holds no CDP socket');
  it.todo('TOOL-7: tool errors are typed (code+message), no raw stack to the model');
  it.todo('HOFF-2: browser_request_login result carries details.piRemoteControlArtifact {kind:html,url:/live/}');
  it.todo('HOFF-10: after a full login handoff, captured tool I/O contains no password and no frame bytes');
  it.todo('HOST-1: activation without ctx.server.realtime throws a clear, actionable error');
});
