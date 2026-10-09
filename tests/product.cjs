// End-to-end check of the product features: import and review, any-recipe cooking, resume after a reload,
// offline use, the on-device fallback, and YouTube mode. Runs against dev-server.js with MOCK_GEMINI=1.
//   node tests/product.cjs <screenshot dir> <base url>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const outDir = process.argv[2];
const base = (process.argv[3] || 'http://localhost:8000').replace(/\/$/, '');
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

// A stand-in for YouTube's IFrame Player: same methods, and the test moves its clock by hand.
const FAKE_YT = () => {
  window.YT = {
    Player: class {
      constructor(el, opts) {
        this.opts = opts; this.t = 0; this.state = -1; this.calls = [];
        const f = document.createElement('div'); f.className = 'fake-yt'; f.innerHTML = '<div style="font:700 22px sans-serif;opacity:.85">YouTube video plays here</div><div style="font:16px sans-serif;opacity:.6;margin-top:6px">(test stand-in for the YouTube player)</div>'; f.style.cssText = 'width:100%;height:100%;background:linear-gradient(135deg,#2a2d33,#14161a);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center';
        el.replaceWith(f);
        window.__yt = this;
        setTimeout(() => opts.events.onReady({ target: this }), 30);
      }
      set(st) { this.state = st; this.opts.events.onStateChange({ data: st }); }
      playVideo() { this.calls.push('play'); this.set(1); }
      pauseVideo() { this.calls.push('pause'); this.set(2); }
      seekTo(t) { this.calls.push(`seek:${t}`); this.t = t; }
      getCurrentTime() { return this.t; }
      destroy() { this.calls.push('destroy'); }
    },
  };
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const newPage = async (ctx, { fakeYt = true } = {}) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|Failed to load resource|youtube|mediapipe/i.test(m.text())) errors.push('console: ' + m.text()); });
    await page.addInitScript(() => { window.__spoken = []; if (window.speechSynthesis) { const o = window.speechSynthesis.speak.bind(window.speechSynthesis); window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); try { o(u); } catch (_) { /* ignore */ } }; } });
    if (fakeYt) await page.addInitScript(FAKE_YT);
    return page;
  };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['microphone', 'camera'] });
  let page = await newPage(ctx);
  const C = (fn, ...a) => page.evaluate(fn, ...a);
  const shot = async (n) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(outDir, n + '.png') }); };
  const voice = (intent, extra = {}) => C(([i, e]) => { const c = window.__cookAlong; c.handleIntent({ intent: i, word: e.word || i, heard: e.heard || i, ...e }, { kind: 'voice', word: e.word || i, heard: e.heard || e.word || i }); c.render(); }, [intent, extra]);
  // Nothing may spill out of a card; scrolling lists are allowed to scroll.
  const overflow = () => C(() => {
    const bad = [];
    const scrolls = (el) => { for (let p = el.parentElement; p && p.id !== 'stage'; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === 'auto' || o === 'scroll') return true; } return false; };
    document.querySelectorAll('#stage .stepcard, #stage .timer, #stage .vcard, #stage .alert, #stage .bottom, #stage .rcard, #stage .addcard, #stage .serves').forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className.split(' ')[0]} ${el.scrollWidth}x${el.scrollHeight} > ${el.clientWidth}x${el.clientHeight}`);
    });
    const stage = document.getElementById('stage').getBoundingClientRect();
    document.querySelectorAll('#stage *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && !scrolls(el) && (r.right > stage.right + 1 || r.bottom > stage.bottom + 1)) bad.push(`outside stage: ${el.tagName}.${String(el.className).slice(0, 30)}`);
    });
    return bad.slice(0, 6);
  });
  const noOverflow = async (label) => { const o = await overflow(); check(`no overflow: ${label}`, o.length === 0, o.join(' | ')); };

  // ================================================================ 1. import pasted text through the server
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.click('[data-tap="add"]');
  await page.waitForTimeout(300);
  await shot('p01-add');
  await noOverflow('add screen');
  await page.click('[data-tap="sample"]');
  await page.click('[data-tap="import"]');
  await page.waitForSelector('.review', { timeout: 15000 });
  await shot('p02-review');
  await noOverflow('review screen');
  const rv = await C(() => ({ title: document.querySelector('.rv-head h1').textContent, steps: document.querySelectorAll('.sedit').length, warns: document.querySelectorAll('.warns > div:not(.k)').length, method: (document.querySelector('.rv-left .muted') || {}).textContent }));
  check('import: server draft opens on the review screen', rv.title === 'Rajma chawal' && rv.steps === 9, JSON.stringify(rv));
  check('import: the review lists what to check', rv.warns >= 2, JSON.stringify(rv));
  check('import: says how it was read', /gemini/i.test(rv.method || ''), rv.method);

  // Edit on the review screen: rename, change a timer, move a step, delete one.
  await page.fill('[data-f="title"]', 'Rajma chawal (Sunday)');
  await page.locator('[data-tnum="1"]').fill('25');
  await page.locator('[data-tnum="1"]').dispatchEvent('change');
  await page.selectOption('[data-timer="2"]', 'countdown');
  await page.locator('[data-tnum="2"]').fill('3');
  await page.locator('[data-tnum="2"]').dispatchEvent('change');
  const edited = await C(() => { const d = window.__cookAlong.S.ui.draft; return { title: d.title, soak: d.steps[1].onEnter[0].minutes, chop: d.steps[2].onEnter && d.steps[2].onEnter[0] }; });
  check('review: typing and timer changes reach the draft', edited.title === 'Rajma chawal (Sunday)' && edited.soak === 25 && edited.chop && edited.chop.minutes === 3, JSON.stringify(edited));
  await page.selectOption('[data-timer="2"]', 'none');
  await page.click('[data-tap="save"]');
  await page.waitForSelector('.start');
  await shot('p03-start-imported');
  await noOverflow('imported recipe page');
  const saved = await C(() => window.__cookAlong.store.listRecipes().map((r) => r.title));
  check('save: the recipe is in the library', saved.includes('Rajma chawal (Sunday)'), JSON.stringify(saved));

  // ================================================================ 2. cook an imported recipe
  await page.uncheck('[data-flag="mic"]');
  await page.uncheck('[data-flag="camera"]');
  await page.click('[data-tap="start"]');
  // First cook: the setup screen explains the microphone and camera before the browser asks.
  await page.waitForSelector('.setup');
  await shot('p03b-setup');
  await noOverflow('setup screen');
  const setupText = await C(() => document.querySelector('.setup').textContent);
  check('setup: explains the microphone and camera before the first cook', /Microphone/.test(setupText) && /Camera/.test(setupText) && /recorded/.test(setupText));
  await page.selectOption('[data-setting="whistle"]', 'less');
  const tuned = await C(() => JSON.parse(localStorage.getItem('cookalong.settings.v1')).cfg.whistleDb);
  check('setup: a sensitivity choice is saved on the device', tuned === -26, String(tuned));
  await page.click('[data-tap="setup-taps"]');
  await C(() => { const S = window.__cookAlong.S; S.voiceState = 'listening'; S.camState = 'on'; });
  await shot('p04-cook-step1');
  await noOverflow('imported step 1');
  const s1 = await C(() => { const S = window.__cookAlong.S; return { pots: Object.keys(S.timers), rail: document.querySelectorAll('.rail .timer').length }; });
  check('cook: whistle timer starts on the rajma pot, rail shows 3 lanes', s1.pots.includes('rajma') && s1.rail === 3, JSON.stringify(s1));
  for (let i = 0; i < 6; i++) await C(() => window.__cookAlong.addWhistle('test'));
  const al = await C(() => ({ alert: window.__cookAlong.S.alert && window.__cookAlong.S.alert.title }));
  check('cook: 6th whistle raises the flame-off alert', al.alert === 'Turn off the flame', JSON.stringify(al));
  await shot('p05-cook-alert');
  await noOverflow('imported alert');
  await voice('ack', { word: 'ho gaya' });
  const cooling = await C(() => window.__cookAlong.S.timers.rajma.type);
  check('cook: ack starts the cooling timer', cooling === 'cooling', cooling);
  // Jump to "open the cooker": it must wait for the cooker.
  await C(() => { const c = window.__cookAlong; c.goToStep(6, { force: true, quiet: true }); c.next({ kind: 'key' }); c.render(); });
  const waited = await C(() => ({ step: window.__cookAlong.S.step, notice: window.__cookAlong.S.notice && window.__cookAlong.S.notice.text }));
  check('cook: opening the cooker waits until it is safe', waited.step === 6 && /cooling/.test(waited.notice || ''), JSON.stringify(waited));
  await voice('yes', { word: 'haan' });
  const forced = await C(() => window.__cookAlong.S.step);
  check('cook: "haan" overrides the wait', forced === 7, String(forced));
  await voice('howmuch', { heard: 'haldi kitna' });
  const hm = await C(() => window.__cookAlong.S.notice && window.__cookAlong.S.notice.text);
  check('cook: "haldi kitna" answers from an imported recipe', /Turmeric/.test(hm || ''), hm);
  // The "can't pause" step is announced one step early.
  await C(() => { const c = window.__cookAlong; c.goToStep(2, { force: true, quiet: true }); c.render(); });
  const heads = await C(() => window.__cookAlong.S.notice && window.__cookAlong.S.notice.text);
  check('cook: a step that can\'t be paused is announced one step early', /moves fast/.test(heads || ''), heads);
  await C(() => { const c = window.__cookAlong; c.goToStep(3, { force: true, quiet: true }); c.S.notice = null; c.S.echo = null; c.render(); });
  await shot('p06-cook-fast');
  await noOverflow('imported fast step');
  const spokenBad = await C(() => (window.__spoken || []).map((l) => [l, (window.__cookAlong.parseCommand(l) || {}).intent || null]).filter(([, i]) => i));
  check('cook: imported spoken lines contain no commands', spokenBad.length === 0, JSON.stringify(spokenBad));
  const swap = await C(() => window.__cookAlong.safeSpoken('Wait until done, then stir again and go back to the pan'));
  check('safe speech: command words are swapped out', swap && !/\b(wait|done|again|back)\b/i.test(swap), swap);

  // Hard mute: hold the status pills for a second.
  await C(() => window.__cookAlong.toggleMute());
  await C(() => window.__cookAlong.render());
  const muted = await C(() => ({ m: window.__cookAlong.S.muted, pill: document.querySelector('.pills').textContent }));
  check('mute: the microphone and camera can be switched fully off', muted.m && /Muted/.test(muted.pill), JSON.stringify(muted));
  const pb = await (await page.$('.pills')).boundingBox();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
  const stillMuted = await C(() => window.__cookAlong.S.muted);
  await page.mouse.down(); await page.waitForTimeout(1150); await page.mouse.up();
  const unmuted = await C(() => window.__cookAlong.S.muted);
  check('mute: half a second is not enough to unmute, a full second is', stillMuted === true && unmuted === false, JSON.stringify({ stillMuted, unmuted }));
  await C(() => { const S = window.__cookAlong.S; S.voiceState = 'listening'; S.camState = 'on'; S.notice = null; });

  // ================================================================ 3. resume after a reload
  await C(() => { const c = window.__cookAlong; c.goToStep(4, { force: true, quiet: true }); c.render(); });
  const before = await C(() => { const S = window.__cookAlong.S; return { step: S.step, masala: S.timers.masala && S.timers.masala.endsAt - S.clock }; });
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  const after = await C(() => { const S = window.__cookAlong.S; return { screen: S.screen, step: S.step, title: S.recipe.title, masala: S.timers.masala && S.timers.masala.endsAt - S.clock, touch: S.needsTouch }; });
  check('resume: a reload comes back on the same step of the same recipe', after.screen === 'cook' && after.step === before.step && after.title === 'Rajma chawal (Sunday)', JSON.stringify({ before, after }));
  check('resume: timers kept running while the page was gone', after.masala < before.masala - 900 && after.masala > before.masala - 6000, JSON.stringify({ before: before.masala, after: after.masala }));
  await shot('p07-resumed');
  check('resume: asks for one touch to turn sound back on', after.touch === true && await C(() => /Touch the screen once/.test(document.querySelector('.bottom').textContent)));
  await page.mouse.click(600, 400);
  const touched = await C(() => window.__cookAlong.S.needsTouch);
  check('resume: one touch clears it (and does not count as a tap)', touched === false);
  // Finish clears the session.
  await C(() => { const c = window.__cookAlong; c.goToStep(8, { force: true, quiet: true }); c.next({ kind: 'key' }); c.render(); });
  await shot('p08-done');
  await noOverflow('imported done');
  await voice('stop', { word: 'khatam karo' });
  await C(() => window.__cookAlong.handleIntent({ intent: 'stop' }, { kind: 'voice' }));
  const cleared = await C(() => localStorage.getItem('cookalong.session.v1'));
  check('done: ending clears the saved session', cleared === null, String(cleared).slice(0, 60));

  // ================================================================ 4. offline: the service worker serves the app
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  const swReady = await C(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'load' }); // let the worker control the page and fill its cache
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  const offline = await C(() => ({ lib: !!document.querySelector('.lib'), recipes: document.querySelectorAll('.rcard-open').length, font: document.fonts.check('800 50px "Atkinson Hyperlegible Next"') }));
  check('offline: the app opens with no network', swReady && offline.lib && offline.recipes === 2, JSON.stringify(offline));
  await shot('p09-offline');

  // ================================================================ 5. offline import falls back to rules on the device
  await page.click('[data-tap="add"]');
  await page.click('[data-tap="sample"]');
  await page.click('[data-tap="import"]');
  await page.waitForSelector('.review', { timeout: 10000 });
  const local = await C(() => { const d = window.__cookAlong.S.ui.draft; return { title: d.title, method: window.__cookAlong.S.ui.method, whistle: d.steps.some((s) => (s.onEnter || []).some((t) => t.type === 'whistle' && t.target === 6)), pots: d.pots.map((p) => p.vessel) }; });
  check('offline import: pasted text is read on the device', /rules on this device/.test(local.method) && local.title === 'Rajma Chawal' && local.whistle && local.pots.includes('cooker'), JSON.stringify(local));
  await shot('p10-offline-review');
  await page.click('[data-tap="discard"]');
  await ctx.setOffline(false);

  // ================================================================ 6. YouTube mode
  await page.goto(`${base}/index.html?nosw`, { waitUntil: 'load' });
  await page.click('[data-tap="add"]');
  await page.fill('#importText', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.click('[data-tap="import"]');
  await page.waitForSelector('.review', { timeout: 15000 });
  await page.click('[data-tap="expand:1"]');
  await shot('p11-review-video');
  const vt = await C(() => document.querySelector('[data-vt="1:start"]').value);
  check('youtube: review shows each step\'s video time', vt === '0:20', vt);
  await page.click('[data-tap="save"]');
  await page.waitForSelector('.start');
  await shot('p12-start-video');
  await noOverflow('video recipe page');
  await page.uncheck('[data-flag="mic"]');
  await page.uncheck('[data-flag="camera"]');
  await page.click('[data-tap="start"]');
  await page.waitForTimeout(400);
  await C(() => { const S = window.__cookAlong.S; S.voiceState = 'listening'; S.camState = 'on'; window.__cookAlong.render(); });
  const v1 = await C(() => ({ calls: window.__yt && window.__yt.calls, layout: document.getElementById('stage').dataset.layout, host: getComputedStyle(document.getElementById('videoHost')).display }));
  check('youtube: video starts at step 1\'s time in the video layout', v1.calls && v1.calls.includes('seek:4') && v1.calls.includes('play') && v1.layout === 'vfar' && v1.host === 'block', JSON.stringify(v1));
  await shot('p13-video-playing');
  await noOverflow('video layout');
  // While it plays, only "ruko" counts: the video's own voice could say "aage".
  await C(() => window.__cookAlong.onTranscript(['aage']));
  const ignored = await C(() => window.__cookAlong.S.step);
  check('youtube: "aage" is ignored while the video plays', ignored === 0, String(ignored));
  await C(() => window.__cookAlong.addWhistle && (window.__cookAlong.S.flags.mic = true));
  // The video reaches the end of step 1's part: it pauses and waits.
  await C(() => { window.__yt.t = 19.9; });
  await page.waitForTimeout(450);
  const waiting = await C(() => ({ waiting: window.__cookAlong.S.video.waiting, state: window.__yt.state, notice: window.__cookAlong.S.notice && window.__cookAlong.S.notice.text }));
  check('youtube: the video pauses itself at the end of the step', waiting.waiting && waiting.state === 2 && /waits for you/.test(waiting.notice || ''), JSON.stringify(waiting));
  await shot('p14-video-waiting');
  await C(() => window.__cookAlong.onTranscript(['aage']));
  const moved = await C(() => ({ step: window.__cookAlong.S.step, last: window.__yt.calls.slice(-2) }));
  check('youtube: "aage" while paused goes to step 2 and plays its part', moved.step === 1 && moved.last.includes('seek:20') && moved.last.includes('play'), JSON.stringify(moved));
  await voice('pause', { word: 'ruko' });
  const paused = await C(() => window.__yt.state);
  check('youtube: "ruko" pauses the video', paused === 2, String(paused));
  await voice('repeat', { word: 'phir se' });
  const again = await C(() => window.__yt.calls.slice(-2));
  check('youtube: "phir se" replays this step\'s part', again.includes('seek:20') && again.includes('play'), JSON.stringify(again));
  // A timer alert pauses the video so the cook can deal with the pot.
  await C(() => { const S = window.__cookAlong.S; const t = Object.values(S.timers).find((x) => x.type !== 'whistle'); t.endsAt = S.clock + 100; });
  await page.waitForTimeout(500);
  await C(() => { const S = window.__cookAlong.S; for (const t of Object.values(S.timers)) if (t.type !== 'whistle' && t.state !== 'done') t.endsAt = S.clock + 50; });
  await page.waitForTimeout(400);
  await page.keyboard.press('n');
  await C(() => { const c = window.__cookAlong; c.S.echo = null; c.S.notice = null; c.render(); });
  await shot('p15-video-near');
  await noOverflow('video near layout');
  const nearLayout = await C(() => document.getElementById('stage').dataset.layout);
  check('youtube: near mode keeps the video between the hold targets', nearLayout === 'vnear', nearLayout);

  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.detail}]`}`).join('\n'));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
