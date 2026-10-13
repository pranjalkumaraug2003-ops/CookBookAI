// Records every line the reviewer tour and a full dal tadka cook ask the voice server for, so they can be
// pre-made as audio files (scripts/fetch-voice.mjs). Runs against the local dev server with the model stubbed.
//   node scripts/record-lines.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const port = 8765;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, ['dev-server.js'], { cwd: root, env: { ...process.env, PORT: String(port), MOCK_GEMINI: '1', LOG_SILENT: '1' }, stdio: 'ignore' });
  await sleep(1200);
  const lines = new Map();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname !== '/api/tts') return;
    const t = u.searchParams.get('t'); const l = u.searchParams.get('l') || 'en-IN';
    lines.set(`${l}|${t}`, { t, l });
  });
  // 1. The tour, every stop, long enough for its timed events.
  await page.goto(`http://localhost:${port}/index.html?nosw&tour=1`, { waitUntil: 'load' });
  await page.waitForSelector('#tourBar .tour-t');
  const count = await page.evaluate(() => window.__cookAlong.tour.count);
  for (let k = 0; k < count; k++) {
    await sleep(7000);
    await page.evaluate((n) => window.__cookAlong.tour.go(n), k + 1).catch(() => {});
  }
  // 2. A full cook of the dal tadka, as a cook would move through it.
  await page.goto(`http://localhost:${port}/index.html?nosw`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__cookAlong && window.__cookAlong.S);
  await page.evaluate(() => { const c = window.__cookAlong; c.openRecipe(c.store.getRecipe('dal-tadka')); });
  await sleep(4000);
  await page.evaluate(() => window.__cookAlong.startCooking());
  const steps = await page.evaluate(() => window.__cookAlong.S.recipe.steps.length);
  for (let k = 1; k < steps; k++) {
    if (k === 3) { await page.evaluate(() => { const c = window.__cookAlong; for (let w = 0; w < 3; w++) c.addWhistle('rec'); }); await sleep(1500); await page.evaluate(() => window.__cookAlong.handleIntent({ intent: 'ack' }, { kind: 'voice' })); await sleep(1500); }
    await page.evaluate((n) => window.__cookAlong.goToStep(n, { force: true }), k);
    await sleep(2500);
  }
  await page.evaluate(() => window.__cookAlong.handleIntent({ intent: 'howmuch', heard: 'namak kitna' }, { kind: 'voice', heard: 'namak kitna' }));
  await sleep(1500);
  await browser.close();
  server.kill();
  const out = [...lines.values()].sort((a, b) => a.l.localeCompare(b.l) || a.t.localeCompare(b.t));
  fs.writeFileSync(path.join(root, 'audio', 'lines.json'), JSON.stringify(out, null, 1));
  console.log(`${out.length} lines recorded to audio/lines.json`);
})();
