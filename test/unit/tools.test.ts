/**
 * TOOL-* — LLM tools register and RPC to the server routes. fetch is mocked so
 * we assert the calls without a running server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browserPiExtension from '../../src/pi/index.js';

function collectTools() {
  const tools = new Map<string, any>();
  browserPiExtension({ registerTool: (t: any) => tools.set(t.name, t) } as any);
  return tools;
}

describe('LLM tools', () => {
  let calls: { url: string; body: any }[];
  beforeEach(() => {
    calls = [];
    process.env.PI_CRUST_API_BASE = 'http://test-host:9999';
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: true, json: async () => ({ ok: true, resumed: true, title: 'T', url: 'u', text: 'body' }) } as any;
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.PI_CRUST_API_BASE; });

  it('TOOL-1: registers the full browser_* tool set', () => {
    const tools = collectTools();
    for (const n of ['browser_open', 'browser_navigate', 'browser_snapshot', 'browser_request_login', 'browser_wait_for_human']) {
      expect(tools.has(n)).toBe(true);
    }
  });

  it('TOOL-2: browser_navigate RPCs to the navigate route with the url', async () => {
    const t = collectTools().get('browser_navigate');
    await t.execute('id', { url: 'https://example.com' }, { sessionId: 'pi-1' });
    expect(calls[0].url).toBe('http://test-host:9999/api/ext/browser/pi-1/navigate');
    expect(calls[0].body).toEqual({ url: 'https://example.com' });
  });

  it('TOOL-4: browser_snapshot RPCs to the snapshot route and returns text', async () => {
    const t = collectTools().get('browser_snapshot');
    const out = await t.execute('id', {}, { sessionId: 'pi-1' });
    expect(calls[0].url).toBe('http://test-host:9999/api/ext/browser/pi-1/snapshot');
    expect(out.content[0].text).toContain('body');
  });

  it('TOOL-7: a tool with no session id throws a clear error (no RPC)', async () => {
    const t = collectTools().get('browser_navigate');
    await expect(t.execute('id', { url: 'x' }, {})).rejects.toThrow(/session id/);
    expect(calls).toHaveLength(0);
  });

  it('HOFF-2: browser_request_login calls /request-login and returns a token-scoped card url', async () => {
    vi.stubGlobal('fetch', async (u: string, init: any) => { calls.push({ url: String(u), body: init?.body ? JSON.parse(init.body) : undefined }); return { ok: true, json: async () => ({ token: 'tok-1' }) } as any; });
    const t = collectTools().get('browser_request_login');
    const out = await t.execute('id', { reason: 'GitHub' }, { sessionId: 'pi-1' });
    expect(calls[0].url).toBe('http://test-host:9999/api/ext/browser/pi-1/request-login');
    expect(out.details.piRemoteControlArtifact.url).toContain('tok-1');
  });

  it('HOFF-3: browser_wait_for_human blocks on /wait (not /resume) and reports the result', async () => {
    const t = collectTools().get('browser_wait_for_human');
    const out = await t.execute('id', { timeoutMs: 5000 }, { sessionId: 'pi-1' });
    expect(calls[0].url).toBe('http://test-host:9999/api/ext/browser/pi-1/wait');
    expect(out.content[0].text).toMatch(/signed in/i);
  });
});
