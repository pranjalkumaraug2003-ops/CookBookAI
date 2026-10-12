// Shared plumbing for the QA phases: paths, the local server, launching a real browser with real or
// fake camera/microphone, saving files sent from the page, waiting for a person to finish a guided session.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = path.join(ROOT, 'qa', 'out');

export function out(...parts) {
  const p = path.join(OUT, ...parts);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function log(line) {
  const text = `[${stamp()}] ${line}`;
  console.log(text);
  fs.appendFileSync(out('run.log'), text + '\n');
}

export function saveJson(name, data) {
  const p = out(name.endsWith('.json') ? name : `${name}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  log(`saved ${path.relative(ROOT, p)}`);
  return p;
}

export function readJson(name, fallback = null) {
  const p = path.join(OUT, name.endsWith('.json') ? name : `${name}.json`);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}

// A small status file the agent can poll while a long, person-guided phase runs.
export function status(phase, state, extra = {}) {
  const all = readJson('status', {});
  all[phase] = { state, at: stamp(), ...extra };
  fs.writeFileSync(out('status.json'), JSON.stringify(all, null, 2));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.setTimeout(1500, () => { req.destroy(); resolve(0); });
  });
}

// Starts dev-server.js on a free-ish port. mock=true answers recipe imports from the test fixtures.
export async function startServer({ mock = false, port } = {}) {
  const p = port || 8100 + Math.floor(Math.random() * 800);
  const env = { ...process.env, PORT: String(p) };
  if (mock) env.MOCK_GEMINI = '1';
  else delete env.MOCK_GEMINI;
  env.LOG_SILENT = '1';
  const child = spawn(process.execPath, ['dev-server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  const url = `http://localhost:${p}`;
  for (let i = 0; i < 60; i++) {
    if (await ping(url + '/index.html')) return { url, stop: () => child.kill() };
    await sleep(250);
  }
  child.kill();
  throw new Error(`dev-server did not start on ${url}`);
}

// Playwright's default flags mute audio and switch off the component extensions that provide Chrome's
// "Google ..." voices and on-device speech. "plain" removes those so the browser behaves like the cook's own.
const PLAIN_REMOVE = [
  '--mute-audio',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-extensions',
];

// browser: 'chrome' (installed Google Chrome), 'msedge' (installed Edge) or 'chromium' (Playwright's own).
// fakeVideo / fakeAudio: paths to a .y4m / .wav fed in place of the real camera / microphone.
export async function launch({ browser = 'chrome', headed = true, plain = true, fakeVideo, fakeAudio, fakeDevices = false, viewport = null, profile = 'default', extraArgs = [] } = {}) {
  const args = ['--autoplay-policy=no-user-gesture-required', ...extraArgs];
  const useFake = fakeDevices || fakeVideo || fakeAudio;
  if (useFake) {
    args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream');
    if (fakeVideo) args.push(`--use-file-for-fake-video-capture=${path.resolve(fakeVideo)}`);
    if (fakeAudio) args.push(`--use-file-for-fake-audio-capture=${path.resolve(fakeAudio)}`);
  } else {
    // Real devices: the permission is granted by the context below, so no prompt blocks the run.
    args.push('--use-fake-ui-for-media-stream');
  }
  const dir = out('profiles', `${browser}-${profile}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const opts = {
    headless: !headed,
    args,
    viewport,
    permissions: ['camera', 'microphone'],
    ignoreDefaultArgs: plain ? PLAIN_REMOVE : ['--mute-audio'],
  };
  let used = browser;
  let context;
  try {
    context = await chromium.launchPersistentContext(dir, browser === 'chromium' ? opts : { ...opts, channel: browser });
  } catch (e) {
    if (browser === 'chromium') throw e;
    log(`could not launch ${browser} (${e.message.split('\n')[0]}); falling back to Playwright's Chromium`);
    used = 'chromium';
    context = await chromium.launchPersistentContext(dir, opts);
  }
  const version = context.browser() ? context.browser().version() : null;
  const page = context.pages()[0] || await context.newPage();
  const consoleLines = [];
  page.on('console', (m) => { if (consoleLines.length < 400) consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 500)); });
  page.on('pageerror', (e) => { consoleLines.push(`pageerror: ${e.message}`.slice(0, 500)); });
  await bridge(page);
  return { context, page, browser: used, version, consoleLines, close: () => context.close() };
}

// Lets a page save files under qa/out (recordings, fixtures, big logs) without a download prompt.
async function bridge(page) {
  await page.exposeFunction('qaSave', (rel, b64, append) => {
    const clean = String(rel).replace(/\\/g, '/').split('/').filter((s) => s && s !== '..' && s !== '.').join('/');
    const p = out(clean);
    const buf = Buffer.from(b64, 'base64');
    if (append) fs.appendFileSync(p, buf); else fs.writeFileSync(p, buf);
    return buf.length;
  });
  await page.exposeFunction('qaLog', (line) => log(`page: ${String(line).slice(0, 400)}`));
}

// Waits (no time limit by default) until the page sets window.__qa.done, then returns window.__qa.results.
export async function waitForPage(page, { timeoutMs = 0, phase } = {}) {
  const started = Date.now();
  for (;;) {
    let st = null;
    try { st = await page.evaluate(() => (window.__qa ? { done: !!window.__qa.done, step: window.__qa.step || '' } : null)); } catch (e) {
      if (/closed|Target/.test(e.message)) throw new Error('The browser window was closed before the session finished.');
    }
    if (st && phase) status(phase, 'running', { step: st.step });
    if (st && st.done) break;
    if (timeoutMs && Date.now() - started > timeoutMs) throw new Error('timed out waiting for the page');
    await sleep(1000);
  }
  return page.evaluate(() => window.__qa.results);
}

// Settings that skip the first-run screen so a test lands straight on the recipe.
export function settingsScript(flags) {
  const s = JSON.stringify({ setupDone: true, flags: { voice: false, camera: false, mic: false, readAloud: false, lang: 'en-IN', video: false, ...flags } });
  return `try { localStorage.setItem('cookalong.settings.v1', ${JSON.stringify(s)}); localStorage.removeItem('cookalong.session.v1'); } catch (_) {}`;
}

export function listFiles(dir, exts) {
  try {
    return fs.readdirSync(dir).filter((f) => !exts || exts.includes(path.extname(f).toLowerCase())).map((f) => path.join(dir, f));
  } catch (_) { return []; }
}
