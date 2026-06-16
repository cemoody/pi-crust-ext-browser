/**
 * pi-crust server activation. Wires the tested core into the host:
 *  - registers the Browser sidebar activity (web module = widget.mjs),
 *  - mounts the browser:* realtime protocol (gateway wiring) backed by a
 *    BrowserService over a real Playwright CDP factory,
 *  - registers the token / live-view / resume / navigate routes,
 *  - serves the bundled live-card client.
 *
 * Host context typed loosely (`any`) so the package floats across pi-crust
 * versions and feature-detects instead.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserService } from '../core/browser-service.js';
import { createPlaywrightCdpFactory } from '../core/cdp-playwright.js';
import { mintLiveViewToken, verifyLiveViewToken } from '../core/live-view-token.js';
import { makeBrowserConnectionHandler } from './realtime.js';
import { createBrowserRoutes } from './routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export default function activate(prc: any): void {
  if (typeof prc?.server?.realtime?.onConnection !== 'function') {
    throw new Error(
      '@cemoody/pi-crust-ext-browser requires a pi-crust version that provides ' +
        'ctx.server.realtime (the per-connection Socket.IO API). Please upgrade pi-crust.',
    );
  }

  prc.activity.registerView({ id: 'cemoody.browser.activity', title: 'Browser', icon: 'globe', order: 41 });

  const secret = process.env.PI_CRUST_BROWSER_SECRET ?? randomBytes(32).toString('hex');
  const resolveSession = async (sessionId: string): Promise<{ cwd: string } | undefined> => {
    try {
      const session = await prc.sessions.get?.(sessionId);
      return session?.cwd ? { cwd: session.cwd } : undefined;
    } catch {
      return undefined;
    }
  };

  // Remote browser: connect to a configured CDP endpoint, else launch headful.
  const factory = createPlaywrightCdpFactory({
    ...(process.env.PI_CRUST_BROWSER_CDP_URL ? { cdpUrl: process.env.PI_CRUST_BROWSER_CDP_URL } : {}),
    // Headless by default (streams the same; needs no display). Opt into a
    // visible window with PI_CRUST_BROWSER_HEADLESS=0 (requires an X display).
    launch: { headless: process.env.PI_CRUST_BROWSER_HEADLESS !== '0' },
  });
  const service = createBrowserService({ cdpFactory: factory });

  // Gateway: per-connection browser:* handlers. Token is OPTIONAL for the
  // same-origin sidebar (the host already authenticates the page); the inline
  // card always passes one, and we verify it when present.
  prc.server.realtime.onConnection(
    makeBrowserConnectionHandler({
      service,
      resolveSession,
      verifyToken: (token, sessionId) => (token ? verifyLiveViewToken(token, sessionId, { secret }) : true),
    }),
  );

  const routes = createBrowserRoutes({ service, secret, resolveSession });
  prc.server.api.post('/api/ext/browser/token', (req: any) => routes.token(req));
  prc.server.api.get('/api/ext/browser/live/:sessionId', (req: any) => routes.liveView(req));
  prc.server.api.post('/api/ext/browser/:sessionId/resume', (req: any) => routes.resume(req));
  prc.server.api.post('/api/ext/browser/:sessionId/navigate', (req: any) => routes.navigate(req));
  prc.server.api.post('/api/ext/browser/:sessionId/snapshot', (req: any) => routes.snapshot(req));

  // Serve the bundled inline-card client (built by scripts/build-web.mjs).
  prc.server.api.get('/api/ext/browser/live-card.js', () => {
    try {
      const js = readFileSync(path.join(here, '..', 'web', 'live-card.js'), 'utf8');
      return { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' }, body: js };
    } catch {
      return { status: 404, body: { error: 'live-card.js not built' } };
    }
  });

  // Expose for the pi-side tools to mint a token without re-deriving the secret.
  (globalThis as any).__piBrowserMintToken = (sessionId: string) =>
    mintLiveViewToken(sessionId, { secret, expiresAt: Date.now() + 60 * 60 * 1000 });
}
