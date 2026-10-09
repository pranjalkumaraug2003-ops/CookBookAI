// Every screen on a phone held upright (390 x 844): nothing spills out of its card or off the screen,
// and the screen is drawn at a readable scale instead of the tablet layout shrunk.
//   node tests/phone.cjs <screenshot dir> <base url>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const outDir = process.argv[2];
const base = (process.argv[3] || 'http://localhost:8000').replace(/\/$/, '');
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

const FAKE_YT = () => {
  window.YT = { Player: class {
    constructor(el, opts) { this.opts = opts; this.t = 0; this.state = -1; const f = document.createElement('div'); f.style.cssText = 'width:100%;height:100%;background:#2a2d33'; el.replaceWith(f); window.__yt = this; setTimeout(() => opts.events.onReady({}), 30); }
    playVideo() { this.state = 1; this.opts.events.onStateChange({ data: 1 }); } pauseVideo() { this.state = 2; this.opts.events.onStateChange({ data: 2 }); }
    seekTo(t) { this.t = t; } getCurrentTime() { return this.t; } destroy() {}
  } };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(FAKE_YT);
  await page.addInitScript(() => { try { if (!localStorage.getItem('cookalong.settings.v1')) localStorage.setItem('cookalong.settings.v1', JSON.stringify({ setupDone: true })); } catch (_) { /* ignore */ } });

  const C = (fn, ...a) => page.evaluate(fn, ...a);
  const voice = (intent, extra = {}) => C(([i, e]) => { const c = window.__cookAlong; c.handleIntent({ intent: i, word: e.word || i, heard: e.heard || i, ...e }, { kind: 'voice', word: e.word || i, heard: e.heard || i }); c.render(); }, [intent, extra]);
  const overflow = () => C(() => {
    const bad = [];
    const scrolls = (el) => { for (let p = el.parentElement; p && p.id !== 'stage'; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === 'auto' || o === 'scroll') return true; } return false; };
    document.querySelectorAll('#stage .stepcard, #stage .timer, #stage .vcard, #stage .alert, #stage .bottom, #stage .beatnow, #stage .then, #stage .rcard, #stage .addcard, #stage .serves, #stage .sedit, #stage .gesture-hud').forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className.split(' ')[0]} ${el.scrollWidth}x${el.scrollHeight}>${el.clientWidth}x${el.clientHeight}`);
    });
    const stage = document.getElementById('stage').getBoundingClientRect();
    document.querySelectorAll('#stage *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && !scrolls(el) && (r.right > stage.right + 1 || r.bottom > stage.bottom + 1 || r.left < stage.left - 1)) bad.push(`outside: ${el.tagName}.${String(el.className).slice(0, 24)}`);
    });
    return [...new Set(bad)].slice(0, 6);
  });
  const look = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(outDir, `${name}.png`) }); const o = await overflow(); check(`phone, no overflow: ${name}`, o.length === 0, o.join(' | ')); };

  await page.goto(`${base}/index.html?nosw`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const geo = await C(() => ({ portrait: document.getElementById('stage').classList.contains('portrait'), w: document.getElementById('stage').getBoundingClientRect().width }));
  check('phone: portrait layout fills the width', geo.portrait && Math.abs(geo.w - 390) < 2, JSON.stringify(geo));
  await look('ph01-library');
  await page.click('[data-tap="add"]');
  await look('ph02-add');
  await page.click('[data-tap="sample"]');
  await page.click('[data-tap="import"]');
  await page.waitForSelector('.review', { timeout: 15000 });
  await look('ph03-review');
  await page.click('[data-tap="save"]');
  await page.waitForSelector('.start');
  await look('ph04-start');
  await C(() => { const c = window.__cookAlong; c.S.flags.mic = false; c.S.flags.camera = false; c.openRecipe(c.store.getRecipe('dal-tadka')); });
  await look('ph05-start-dal');
  await C(() => { const c = window.__cookAlong; c.startCooking(); c.S.voiceState = 'listening'; c.S.camState = 'on'; c.S.nearOverride = false; c.render(); });
  await look('ph06-step1');
  await voice('next', { word: 'aage' }); await voice('next', { word: 'aage' });
  await C(() => { const c = window.__cookAlong; c.addWhistle('t'); c.addWhistle('t'); c.S.echo = null; c.S.notice = null; c.render(); });
  await look('ph07-whistles');
  await C(() => window.__cookAlong.addWhistle('t'));
  await look('ph08-alert');
  await voice('ack', { word: 'ho gaya' });
  await voice('next', { word: 'aage' });
  await C(() => { const c = window.__cookAlong; c.S.nearOverride = true; c.render(); });
  await look('ph09-near-checklist');
  await C(() => { const c = window.__cookAlong; c.S.nearOverride = false; c.goToStep(5, { force: true, quiet: true }); c.S.engaged = true; c.S.engagedAt = Date.now(); c.render(); });
  await look('ph10-gesture');
  await C(() => { const c = window.__cookAlong; c.S.engaged = false; c.goToStep(7, { force: true, quiet: true }); c.S.echo = null; c.S.notice = null; c.render(); });
  await look('ph11-lineup');
  await voice('servings', { servings: 6, word: '6 logon ke liye' });
  await look('ph12-scale');
  await voice('no', { word: 'nahi' });
  await C(() => { const c = window.__cookAlong; c.goToStep(9, { force: true, quiet: true }); c.render(); });
  await look('ph13-tadka');
  await C(() => { const c = window.__cookAlong; c.S.awaySince = Date.now() - 180000; c.handleIntent({ intent: 'where' }, { kind: 'voice' }); c.render(); });
  await look('ph14-recap');
  await C(() => { const c = window.__cookAlong; c.S.sheet = null; c.handleIntent({ intent: 'help' }, { kind: 'voice' }); c.render(); });
  await look('ph15-help');
  await C(() => { const c = window.__cookAlong; c.S.sheet = null; c.goToStep(10, { force: true, quiet: true }); c.next({ kind: 'key' }); c.render(); });
  await look('ph16-done');
  // a YouTube recipe
  await C(() => { const c = window.__cookAlong; c.S.screen = 'library'; c.render(); });
  await page.click('[data-tap="add"]');
  await page.fill('#importText', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.click('[data-tap="import"]');
  await page.waitForSelector('.review', { timeout: 15000 });
  await page.click('[data-tap="save"]');
  await page.waitForSelector('.start');
  await C(() => { const c = window.__cookAlong; c.S.flags.mic = false; c.S.flags.camera = false; c.startCooking(); c.S.camState = 'on'; c.S.voiceState = 'listening'; c.S.nearOverride = false; c.render(); });
  await page.waitForTimeout(500);
  const v = await C(() => { const h = document.getElementById('videoHost').getBoundingClientRect(); const f = document.querySelector('.vframe').getBoundingClientRect(); return { dx: Math.abs(h.left - f.left) + Math.abs(h.top - f.top) + Math.abs(h.width - f.width) + Math.abs(h.height - f.height), layout: document.getElementById('stage').dataset.layout }; });
  check('phone: the video sits exactly over its frame', v.dx < 2 && v.layout === 'vfar', JSON.stringify(v));
  await look('ph17-video');
  check('phone: no page errors', errors.length === 0, errors.join(' | '));
  await page.goto(base + '/privacy.html');
  const pw = await C(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check('privacy page: no sideways scroll on a phone', pw.sw <= pw.cw, pw);
  await page.screenshot({ path: path.join(outDir, 'phone-privacy.png') });
  const failed = results.filter((r) => !r.ok);
  console.log(results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.detail}]`}`).join('\n'));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
