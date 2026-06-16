import http from 'node:http';
import { rmSync } from 'node:fs';
const EXT = '/home/coder/pi-crust-ext-browser';
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.HOME + '/.cache/ms-playwright';
const { createPlaywrightCdpFactory } = await import(`${EXT}/dist/core/cdp-playwright.js`);
const PORT = 8095;
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>persist</title><body>ok</body>'); });
await new Promise((r) => server.listen(PORT, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profileDir = '/tmp/e2e/profiles';
rmSync(profileDir, { recursive: true, force: true });
const url = `http://127.0.0.1:${PORT}/p.html`;
const factory = createPlaywrightCdpFactory({ profileDir });

// Session 1: write a cookie + localStorage, then close.
const a = await factory.create('sess-A');
await a.session.send('Page.navigate', { url });
await sleep(800);
await a.session.send('Runtime.evaluate', { expression: `document.cookie='token=abc123; path=/; max-age=3600'; localStorage.setItem('login','octocat'); 'set'`, returnByValue: true });
await sleep(300);
await a.close();
await sleep(500);

// Session 2: SAME sessionId -> same profile dir -> should restore cookie + localStorage.
const b = await factory.create('sess-A');
await b.session.send('Page.navigate', { url });
await sleep(800);
const res = await b.session.send('Runtime.evaluate', { expression: `JSON.stringify({cookie: document.cookie, login: localStorage.getItem('login')})`, returnByValue: true });
const v = JSON.parse(res?.result?.value ?? '{}');
console.log('after restart:', JSON.stringify(v));
console.log(v.cookie.includes('token=abc123') && v.login === 'octocat' ? 'PASS: session persisted across restart' : 'ROUGH: did not persist');
await b.close();
server.close();
process.exit(0);
