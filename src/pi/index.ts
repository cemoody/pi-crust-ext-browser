/**
 * pi (agent) side: LLM-facing browser tools. They drive the server-owned
 * browser by RPC to the extension routes, and `browser_request_login` emits the
 * inline live-view artifact (Tier-B) so the human can sign in mid-conversation.
 *
 * Cross-process config (when pi and pi-crust run separately):
 *   PI_CRUST_API_BASE     base URL of the pi-crust API (default http://127.0.0.1:8787)
 *   PI_CRUST_BROWSER_SECRET  shared secret used to mint live-view tokens
 *
 * Host API typed loosely so the package floats across pi versions.
 */
import { buildLoginArtifact } from '../prc/login-artifact.js';

const apiBase = () => process.env.PI_CRUST_API_BASE ?? 'http://127.0.0.1:8787';

function sessionIdOf(ctx: any): string | undefined {
  return ctx?.sessionId ?? ctx?.session?.id ?? process.env.PI_CRUST_BROWSER_SESSION_ID;
}

async function rpc(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${apiBase()}/api/ext/browser${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`browser RPC ${path} failed: ${res.status}`);
  return res.json().catch(() => ({}));
}

export default function browserPiExtension(pi: any): void {
  const obj = (props: Record<string, unknown> = {}) => ({ type: 'object', properties: props, additionalProperties: true });

  pi.registerTool?.({
    name: 'browser_open',
    label: 'Open browser',
    description: 'Open/ensure the live remote browser for this session and optionally navigate to a URL.',
    parameters: obj({ url: { type: 'string' } }),
    async execute(_id: string, params: any, ctx: any) {
      const sessionId = sessionIdOf(ctx);
      if (!sessionId) throw new Error('no session id available');
      if (params?.url) await rpc(`/${encodeURIComponent(sessionId)}/navigate`, { url: params.url });
      return { content: [{ type: 'text', text: `Browser ready${params?.url ? ` at ${params.url}` : ''}. Open the Browser panel to watch.` }] };
    },
  });

  pi.registerTool?.({
    name: 'browser_navigate',
    label: 'Navigate browser',
    description: 'Navigate the live remote browser to a URL.',
    parameters: obj({ url: { type: 'string' } }),
    async execute(_id: string, params: any, ctx: any) {
      const sessionId = sessionIdOf(ctx);
      if (!sessionId) throw new Error('no session id available');
      if (!params?.url) throw new Error('url required');
      await rpc(`/${encodeURIComponent(sessionId)}/navigate`, { url: params.url });
      return { content: [{ type: 'text', text: `Navigated to ${params.url}.` }] };
    },
  });

  pi.registerTool?.({
    name: 'browser_request_login',
    label: 'Request login',
    description:
      'Ask the human to sign in: renders a live, interactive browser card inline in the conversation so the user can enter credentials directly. Credentials never pass through the model.',
    parameters: obj({ reason: { type: 'string' } }),
    async execute(_id: string, params: any, ctx: any) {
      const sessionId = sessionIdOf(ctx);
      if (!sessionId) throw new Error('no session id available');
      const reason = typeof params?.reason === 'string' && params.reason ? params.reason : 'Sign in to continue';
      // Tell the server to enter awaiting-human (shows the banner to viewers) and
      // mint a session-scoped token for the inline card.
      const { token } = await rpc(`/${encodeURIComponent(sessionId)}/request-login`, { reason });
      if (!token) throw new Error('server did not return a live-view token');
      return buildLoginArtifact(sessionId, reason, { token });
    },
  });

  pi.registerTool?.({
    name: 'browser_snapshot',
    label: 'Snapshot page',
    description: 'Return the current page url/title/visible text (model-safe; secret field values are never included).',
    parameters: obj({}),
    async execute(_id: string, _params: any, ctx: any) {
      const sessionId = sessionIdOf(ctx);
      if (!sessionId) throw new Error('no session id available');
      const snap = await rpc(`/${encodeURIComponent(sessionId)}/snapshot`, {});
      return { content: [{ type: 'text', text: `# ${snap.title}\n${snap.url}\n\n${snap.text}` }] };
    },
  });

  pi.registerTool?.({
    name: 'browser_wait_for_human',
    label: 'Wait for human',
    description: 'Block until the human clicks Resume in the live browser card (after signing in).',
    parameters: obj({ timeoutMs: { type: 'number' } }),
    async execute(_id: string, params: any, ctx: any) {
      const sessionId = sessionIdOf(ctx);
      if (!sessionId) throw new Error('no session id available');
      // Blocks server-side until the human clicks Resume in the card (or timeout).
      const r = await rpc(`/${encodeURIComponent(sessionId)}/wait`, { timeoutMs: params?.timeoutMs });
      return { content: [{ type: 'text', text: r?.resumed ? 'Human signed in; resuming.' : 'Sign-in not completed (timed out or no pending request).' }] };
    },
  });
}
