// REPL driver for the NextBYT static site. No build step, no framework —
// this launches a plain static file server + a headless Chromium page and
// exposes commands over stdin for an agent to drive.
// Run under tmux: send-keys one command at a time, capture-pane for output.
import { chromium } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

const SITE_DIR = path.resolve(import.meta.dirname, '../../..'); // Website/
const PORT = process.env.PORT || 8842;
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/nextbyt-shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

let server = null;
let browser = null;
let page = null;

const COMMANDS = {
  async serve() {
    if (server) return console.log('already serving on', PORT);
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: SITE_DIR, stdio: 'ignore' });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://localhost:${PORT}/index.html`);
        if (r.ok) { console.log('serving', SITE_DIR, 'on', PORT); return; }
      } catch {}
      await new Promise(r => setTimeout(r, 300));
    }
    console.log('ERROR: server did not come up');
  },

  async launch() {
    if (page) return console.log('already launched');
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
    console.log('browser launched');
  },

  // NextBYT pages fade in via a 1.8s preloader (see CLAUDE.md) — nav alone
  // isn't "ready". Wait for that to clear before screenshotting/interacting.
  async nav(urlPath) {
    if (!page) return console.log('ERROR: launch first');
    await page.goto(`http://localhost:${PORT}/${urlPath || 'index.html'}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#preloader', { state: 'hidden', timeout: 5000 }).catch(() => {});
    console.log('nav ->', urlPath || 'index.html');
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    try { await page.click(sel, { timeout: 5000 }); console.log('clicked', sel); }
    catch (e) { console.log('ERROR:', e.message.split('\n')[0]); }
  },

  async fill(args) {
    if (!page) return console.log('ERROR: launch first');
    const sp = args.indexOf(' ');
    const sel = args.slice(0, sp), value = args.slice(sp + 1);
    try { await page.fill(sel, value); console.log('filled', sel); }
    catch (e) { console.log('ERROR:', e.message.split('\n')[0]); }
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try { await page.waitForSelector(sel, { timeout: 10_000 }); console.log('found:', sel); }
    catch { console.log('TIMEOUT:', sel); }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try { console.log(JSON.stringify(await page.evaluate(expr))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate(s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null));
  },

  async quit() {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
    page = null; browser = null; server = null;
  },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

// readline fires 'line' for every buffered line as soon as it arrives — with
// piped/heredoc input that's all lines at once. Without this chain, multiple
// async commands (e.g. "launch" then "nav") run concurrently instead of in
// order, so "nav" sees page===null because "launch" hasn't resolved yet.
let queue = Promise.resolve();
let closed = false;
rl.on('close', () => { closed = true; });
const safePrompt = () => { if (!closed) try { rl.prompt(); } catch {} };

rl.on('line', line => {
  queue = queue.then(async () => {
    const sp = line.trim().indexOf(' ');
    const cmd = sp === -1 ? line.trim() : line.trim().slice(0, sp);
    const rest = sp === -1 ? '' : line.trim().slice(sp + 1);
    if (!cmd) return safePrompt();
    const fn = COMMANDS[cmd];
    if (!fn) { console.log('unknown:', cmd, '— try: help'); return safePrompt(); }
    try { await fn(rest); } catch (e) { console.log('ERROR:', e.message); }
    safePrompt();
  });
});
// With piped/heredoc input, stdin hits EOF (firing 'close') the instant all
// lines are buffered — long before the queued async commands above have
// actually run. Wait for the queue to drain before tearing anything down.
rl.on('close', async () => { await queue; await COMMANDS.quit(); process.exit(0); });

console.log('nextbyt-website driver — "help" for commands, "serve" then "launch" to start');
rl.prompt();
