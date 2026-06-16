/**
 * HTTP routes for the browser extension (GW-4):
 *   POST /api/ext/browser/token   { sessionId }        -> { token }      (host-auth'd)
 *   GET  /api/ext/browser/live/:sessionId?token=...     -> inline-card HTML (SEC-8)
 *   POST /api/ext/browser/:sessionId/resume             -> { resumed }   (HOFF-3)
 *   POST /api/ext/browser/:sessionId/navigate { url }   -> { ok }        (TOOL-2)
 *
 * Factored as a deps-injected map of handlers so they're unit-testable without
 * the pi-crust HTTP server.
 */
import type { BrowserService } from '../core/protocol.js';
import { mintLiveViewToken, verifyLiveViewToken } from '../core/live-view-token.js';
import { renderLiveCardHtml } from './live-card-html.js';

export interface RouteRequest {
  readonly params: Record<string, string>;
  readonly url: URL;
  json<T = unknown>(): Promise<T>;
}
export interface RouteResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface BrowserRoutesDeps {
  readonly service: BrowserService;
  readonly secret: string;
  /** Token lifetime in ms (default 1h). */
  readonly tokenTtlMs?: number;
  resolveSession(sessionId: string): Promise<{ cwd: string } | undefined>;
  /** For the live-card script: how the host serves the bundled gateway client. */
  readonly liveCardAssetUrl?: string;
}

export function createBrowserRoutes(deps: BrowserRoutesDeps) {
  const ttl = deps.tokenTtlMs ?? 60 * 60 * 1000;

  return {
    async token(req: RouteRequest): Promise<RouteResponse> {
      const { sessionId } = await req.json<{ sessionId?: string }>().catch(() => ({ sessionId: undefined }));
      if (!sessionId) return { status: 400, body: { error: 'sessionId required' } };
      if (!(await deps.resolveSession(sessionId).catch(() => undefined))) {
        return { status: 404, body: { error: `unknown session: ${sessionId}` } };
      }
      const token = mintLiveViewToken(sessionId, { secret: deps.secret, expiresAt: Date.now() + ttl });
      return { status: 200, body: { token } };
    },

    async liveView(req: RouteRequest): Promise<RouteResponse> {
      const sessionId = req.params.sessionId;
      const token = req.url.searchParams.get('token') ?? undefined;
      if (!sessionId || !token || !verifyLiveViewToken(token, sessionId, { secret: deps.secret })) {
        return { status: 403, body: { error: 'invalid or missing live-view token' } };
      }
      return {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: renderLiveCardHtml({ sessionId, token, assetUrl: deps.liveCardAssetUrl ?? '/api/ext/browser/live-card.js' }),
      };
    },

    async resume(req: RouteRequest): Promise<RouteResponse> {
      const sessionId = req.params.sessionId;
      if (!(await deps.resolveSession(sessionId).catch(() => undefined))) {
        return { status: 404, body: { error: `unknown session: ${sessionId}` } };
      }
      const browserId = await deps.service.openSession(sessionId);
      const r = deps.service.resume(browserId);
      return { status: 200, body: r };
    },

    async navigate(req: RouteRequest): Promise<RouteResponse> {
      const sessionId = req.params.sessionId;
      const { url } = await req.json<{ url?: string }>().catch(() => ({ url: undefined }));
      if (!url) return { status: 400, body: { error: 'url required' } };
      if (!(await deps.resolveSession(sessionId).catch(() => undefined))) {
        return { status: 404, body: { error: `unknown session: ${sessionId}` } };
      }
      const browserId = await deps.service.openSession(sessionId);
      await deps.service.navigate(browserId, url);
      return { status: 200, body: { ok: true, browserId } };
    },
  };
}
