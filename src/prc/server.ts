/**
 * pi-crust server activation. Registers the Browser sidebar activity and (will)
 * mount the `browser:*` realtime protocol that streams the BrowserService to
 * viewers. The core BrowserService (src/core) is implemented + unit-tested; the
 * realtime/route wiring is the next TDD layer (see test/contract).
 *
 * Host context is typed loosely (`any`) so the package has no hard dependency on
 * a specific pi-crust version's exported types — it feature-detects instead.
 */
export default function activate(prc: any): void {
  // Requires the `ctx.server.realtime` capability (pi-crust core with the
  // per-connection Socket.IO API). Fail clearly on older hosts (HOST-1).
  if (typeof prc?.server?.realtime?.onConnection !== 'function') {
    throw new Error(
      '@cemoody/pi-crust-ext-browser requires a pi-crust version that provides ' +
        'ctx.server.realtime (the per-connection Socket.IO API). Please upgrade pi-crust.',
    );
  }

  // Usually-hidden sidebar entry; the matching web module renders the canvas.
  prc.activity.registerView({
    id: 'cemoody.browser.activity',
    title: 'Browser',
    icon: 'globe',
    order: 41,
  });

  // TODO(layer 3): mount the `browser:*` realtime handler backed by
  // createBrowserService(...) and the live-view route (`/api/ext/browser/...`).
}
