// QA runner. Each phase opens a real browser on this computer, runs one guided or automatic check, and
// saves results to qa/out. Usage:
//   node qa/run.mjs <phase> [--browser chrome|msedge|chromium] [--quick] [--mp pinned|latest] [--langs en-IN,hi-IN]
// Phases: ping, env, mpbench, gesture, voice, tts, app, collect
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, OUT, out, log, saveJson, status, startServer, launch, waitForPage, sleep } from './lib/common.mjs';
import { openApp, startCook, snap, LogWatch } from './lib/app.mjs';

const [phase = 'help', ...rest] = process.argv.slice(2);
const opt = (name, def) => { const i = rest.indexOf(`--${name}`); return i < 0 ? def : (rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : true); };
const browser = opt('browser', 'chrome');
const quick = !!opt('quick', false);

async function lab(mode, { name = mode, query = '', headed = true } = {}) {
  status(name, 'starting');
  const srv = await startServer();
  const b = await launch({ browser, headed, profile: name });
  try {
    await b.page.goto(`${srv.url}/qa/pages/lab.html?mode=${mode}${quick ? '&quick=1' : ''}${query}`);
    const results = await waitForPage(b.page, { phase: name });
    results.browserUsed = b.browser;
    results.console = b.consoleLines.filter((l) => /error|warn/i.test(l)).slice(0, 50);
    saveJson(`${name}-${b.browser}`, results);
    status(name, results.fatal ? 'failed' : 'done', results.fatal ? { error: results.fatal } : {});
    return results;
  } finally { await b.close().catch(() => {}); srv.stop(); }
}

// The real app, real camera and microphone, for the agent's guided cook. Records the app's state every
// half second until the browser window is closed.
async function appSession() {
  status('app', 'starting');
  const srv = await startServer();
  const b = await launch({ browser, headed: true, profile: 'app' });
  const watch = new LogWatch(); const trace = [];
  try {
    await openApp(b.page, srv.url, { voice: true, camera: true, mic: true, readAloud: true, lang: opt('lang', 'en-IN') });
    await startCook(b.page, 0);
    log('App is open on step 1 with voice, camera, microphone and read-aloud on. Close the window to finish.');
    status('app', 'running');
    for (;;) {
      let s;
      try { s = await snap(b.page); } catch (_) { break; }
      watch.add(s.log); delete s.log; trace.push(s);
      await sleep(500);
    }
  } finally {
    saveJson(`app-${b.browser}`, { browser: b.browser, log: watch.lines, trace: trace.filter((s, i) => i % 2 === 0), console: b.consoleLines.slice(0, 200) });
    await b.close().catch(() => {}); srv.stop(); status('app', 'done');
  }
}

function collect() {
  const share = out('share', 'x'); fs.rmSync(path.dirname(share), { recursive: true, force: true });
  const dir = path.dirname(out('share', 'x'));
  const copy = (src, dst) => { if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, dst), { recursive: true }); };
  for (const f of fs.readdirSync(OUT)) if (/\.(json|md|log|txt)$/.test(f)) copy(path.join(OUT, f), f);
  copy(path.join(OUT, 'raw'), 'raw');
  copy(path.join(OUT, 'screens'), 'screens');
  const zip = path.join(OUT, 'qa-results.zip');
  fs.rmSync(zip, { force: true });
  try {
    if (process.platform === 'win32') execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${dir}\\*' -DestinationPath '${zip}' -Force"`);
    else execSync(`cd "${dir}" && zip -qr "${zip}" .`);
    log(`zip ready: ${path.relative(ROOT, zip)} (recordings of your face and voice are NOT included)`);
  } catch (e) { log(`could not zip (${e.message.split('\n')[0]}); send the folder ${path.relative(ROOT, dir)} instead`); }
}

const PHASES = {
  ping: () => lab('ping', { headed: false }),
  env: () => lab('env'),
  mpbench: async () => { await lab('mpbench', { name: 'mpbench-pinned', query: '&mp=pinned' }); await lab('mpbench', { name: 'mpbench-latest', query: '&mp=latest' }); },
  gesture: () => lab('gesture', { query: `&mp=${opt('mp', 'pinned')}` }),
  voice: () => lab('voice', { query: `&langs=${opt('langs', 'en-IN,hi-IN')}` }),
  tts: () => lab('tts'),
  app: appSession,
  collect,
};
if (!PHASES[phase]) {
  console.log('Phases: ping, env, mpbench, gesture, voice, tts, app, collect. Options: --browser chrome|msedge|chromium --quick --mp latest --langs en-IN,hi-IN');
  process.exit(phase === 'help' ? 0 : 1);
}
fs.mkdirSync(OUT, { recursive: true });
log(`phase ${phase} (${browser}${quick ? ', quick' : ''})`);
Promise.resolve(PHASES[phase]()).then(() => log(`phase ${phase} finished`)).catch((e) => { log(`phase ${phase} FAILED: ${e.stack || e}`); status(phase, 'failed', { error: String(e.message || e) }); process.exit(1); });
