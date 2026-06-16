/**
 * Real interaction e2e: the actual widget (in a browser) -> real socket.io
 * gateway -> real BrowserService -> real headless Chrome. Assertions read the
 * REMOTE DOM (ground truth), not screenshots. Runs realistic user flows and
 * reports rough spots.
 *
 *   node test/e2e/interaction/run.mjs   (after: npm run build)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const EXT = '/home/coder/pi-crust-ext-browser';
const PW = '/home/coder/pi-crust-main/node_modules/playwright/index.js';
const SIO = '/home/coder/pi-crust-main/node_modules/socket.io/dist/index.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const REMOTE_PORT = 9444;
const HTTP_PORT = 8090;

const pw = (await import(PW)).default ?? (await import(PW));
const chromium = pw.chromium;
const { Server: IOServer } = await import(SIO);
const { createBrowserService } = await import(`${EXT}/dist/core/browser-service.js`);
const { createPlaywrightCdpFactory } = await import(`${EXT}/dist/core/cdp-playwright.js`);
const { makeBrowserConnectionHandler } = await import(`${EXT}/dist/prc/realtime.js`);
const { createBrowserRoutes } = await import(`${EXT}/dist/prc/routes.js`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const note = (flow, ok, msg) => { results.push({ flow, ok, msg }); console.log(`${ok ? 'PASS' : 'ROUGH'}  ${flow}: ${msg}`); };

// 1) Launch the "remote" Chrome the extension will stream.
const remote = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${REMOTE_PORT}`] });
await sleep(800);
const cdpUrl = `http://127.0.0.1:${REMOTE_PORT}`;

// 2) Bundle the widget page (real React + real socket.io-client).
await build({
  entryPoints: [path.join(here, 'page-entry.ts')],
  outfile: '/tmp/e2e/page.js', bundle: true, format: 'esm', platform: 'browser', target: ['es2022'],
  nodePaths: [`${EXT}/node_modules`], logLevel: 'error',
});

// 3) Gateway + routes + static server.
const service = createBrowserService({ cdpFactory: createPlaywrightCdpFactory({ cdpUrl }), homeUrl: undefined });
const resolveSession = async () => ({ cwd: '/tmp' });
const routes = createBrowserRoutes({ service, secret: 'test', resolveSession });
const sendJson = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const files = {
  '/': `<!doctype html><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>html,body,#app{margin:0;height:100%}</style><div id=app></div><script type=module src="/page.js"></script>`,
  '/page.js': fs.readFileSync('/tmp/e2e/page.js', 'utf8'),
  '/testpage.html': fs.readFileSync('/tmp/e2e/testpage.html', 'utf8'),
  '/page2.html': fs.readFileSync('/tmp/e2e/page2.html', 'utf8'),
};
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${HTTP_PORT}`);
  const m = u.pathname.match(/^\/api\/ext\/browser\/([^/]+)\/(navigate|reload|back|resume)$/);
  if (m) {
    let body = ''; for await (const c of req) body += c;
    const reqObj = { params: { sessionId: m[1] }, url: u, json: async () => (body ? JSON.parse(body) : {}) };
    const out = await routes[m[2] === 'back' ? 'back' : m[2]](reqObj);
    return sendJson(res, out.status ?? 200, out.body ?? {});
  }
  const f = files[u.pathname];
  if (f !== undefined) { res.writeHead(200, { 'content-type': u.pathname.endsWith('.js') ? 'text/javascript' : 'text/html' }); return res.end(f); }
  res.writeHead(404); res.end('nope');
});
const io = new IOServer(server, { path: '/socket.io/', cors: { origin: true } });
const handler = makeBrowserConnectionHandler({ service, resolveSession, verifyToken: () => true });
io.on('connection', (socket) => {
  const conn = { id: socket.id, on: (e, h) => socket.on(e, h), emit: (e, p) => socket.emit(e, p) };
  const dispose = handler(conn);
  socket.on('disconnect', () => { try { dispose(); } catch {} });
});
await new Promise((r) => server.listen(HTTP_PORT, r));

// 4) Assertion connection to the remote Chrome (ground truth).
const assertConn = await chromium.connectOverCDP(cdpUrl);
const remotePage = assertConn.contexts()[0].pages()[0] ?? (await assertConn.contexts()[0].newPage());
const remoteEval = (fn, ...a) => remotePage.evaluate(fn, ...a);
const rect = (sel) => remoteEval((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const val = (sel) => remoteEval((s) => document.querySelector(s)?.value ?? null, sel);

// 5) The "user" browser with the widget.
const ub = await chromium.launch({ headless: true });
const upage = await (await ub.newContext({ viewport: { width: 1000, height: 760 }, permissions: ['clipboard-read', 'clipboard-write'] })).newPage();
const errs = []; upage.on('pageerror', (e) => errs.push(String(e)));
await upage.goto(`http://127.0.0.1:${HTTP_PORT}/?session=e2e`, { waitUntil: 'networkidle' });
await sleep(1500);

// Navigate the remote to our test page via the widget address bar (real user action).
const addr = upage.locator('[data-testid=url]');
await addr.click(); await addr.fill(`http://127.0.0.1:${HTTP_PORT}/testpage.html`); await addr.press('Enter');
await sleep(2500);

const canvas = upage.locator('canvas');
const cbox = await canvas.boundingBox();
// remote (x,y) maps 1:1 to canvas display (viewport == display size, dpr 1)
const clickRemote = async (sel) => { const r = await rect(sel); if (!r) throw new Error('no ' + sel); await upage.mouse.click(cbox.x + r.x + r.w / 2, cbox.y + r.y + r.h / 2); await sleep(250); };
const type = async (s) => { await upage.keyboard.type(s, { delay: 30 }); await sleep(200); };

try {
  note('load', (await remoteEval(() => document.title)) === 'Test Page', `remote title = ${await remoteEval(() => document.title)}`);

  // STEALTH: automation tells should be masked on the remote page.
  const wd = await remoteEval(() => navigator.webdriver);
  note('stealth-webdriver', wd === false, `navigator.webdriver = ${wd} (want false)`);
  const langs = await remoteEval(() => navigator.languages?.length || 0);
  note('stealth-languages', langs > 0, `navigator.languages length = ${langs}`);

  // FLOW 1: search box — type, verify, backspace, verify, submit (Enter)
  await clickRemote('#q');
  await type('hello world');
  note('type', (await val('#q')) === 'hello world', `#q = ${JSON.stringify(await val('#q'))}`);
  await upage.keyboard.press('Backspace'); await upage.keyboard.press('Backspace'); await upage.keyboard.press('Backspace'); await upage.keyboard.press('Backspace'); await upage.keyboard.press('Backspace'); await sleep(200);
  note('backspace', (await val('#q')) === 'hello ', `#q after 5x backspace = ${JSON.stringify(await val('#q'))}`);
  // select-all + replace (Ctrl+A then type)
  await upage.keyboard.press('Control+a'); await type('cats');
  note('select-all+replace', (await val('#q')) === 'cats', `#q = ${JSON.stringify(await val('#q'))}`);
  // submit via Enter
  await upage.keyboard.press('Enter'); await sleep(400);
  note('enter-submit', (await remoteEval(() => document.getElementById('result')?.textContent || '')).includes('SUBMITTED:cats'), `result = ${await remoteEval(() => document.getElementById('result')?.textContent)}`);

  // FLOW 1b: PASTE from the local clipboard into a remote field (passwords).
  await clickRemote('#q');
  await upage.evaluate(() => { try { return navigator.clipboard.writeText('pa$$w0rd'); } catch { return null; } });
  await upage.keyboard.press('Control+a');
  await upage.keyboard.press('Control+v'); await sleep(300);
  note('paste', (await val('#q')) === 'pa$$w0rd', `#q after paste = ${JSON.stringify(await val('#q'))}`);

  // FLOW 2: login form — Tab between fields
  await clickRemote('#user'); await type('octocat');
  await upage.keyboard.press('Tab'); await sleep(200);
  const focusAfterTab = await remoteEval(() => document.activeElement?.id);
  note('tab-moves-focus', focusAfterTab === 'pass', `focus after Tab = ${focusAfterTab} (expected pass)`);
  await type('s3cret');
  note('login-values', (await val('#user')) === 'octocat' && (await val('#pass')) === 's3cret', `user=${await val('#user')} pass=${await val('#pass')}`);

  // FLOW 3: scroll via drag (touch) — switch to a touch context check; here test wheel via drag on desktop is mouse-drag (not scroll). Use the remote scroll through a touch emulation page instead:
  const beforeScroll = await remoteEval(() => window.scrollY);
  // simulate a wheel scroll by dragging is touch-only; do a desktop mouse wheel over the canvas
  await upage.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
  await upage.mouse.wheel(0, 600); await sleep(500);
  const afterScroll = await remoteEval(() => window.scrollY);
  note('wheel-scroll', afterScroll > beforeScroll, `scrollY ${beforeScroll} -> ${afterScroll}`);

  // FLOW 4: address bar to page2, then Back button
  await addr.click(); await addr.fill(`http://127.0.0.1:${HTTP_PORT}/page2.html`); await addr.press('Enter'); await sleep(2000);
  note('navigate-page2', (await remoteEval(() => document.title)) === 'Page Two', `title = ${await remoteEval(() => document.title)}`);
  const backBtn = upage.locator('button[aria-label=Back]');
  await backBtn.click(); await sleep(2000);
  note('back-button', (await remoteEval(() => document.title)) === 'Test Page', `title after Back = ${await remoteEval(() => document.title)}`);

  note('no-page-errors', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : 'none');
} catch (e) {
  note('exception', false, String(e?.stack ?? e));
}

console.log('\n=== SUMMARY ===');
for (const r of results) console.log(`${r.ok ? '✅' : '⚠️ '} ${r.flow}: ${r.msg}`);
const rough = results.filter((r) => !r.ok);
console.log(`\n${rough.length} rough spot(s).`);

await ub.close(); await assertConn.close(); io.close(); server.close(); await remote.close();
process.exit(0);
