// End-to-end check of the Cook-Along prototype: drives the flow through the test hook, takes screenshots,
// and asserts behaviour that a demo or an interviewer would poke at.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const outDir = process.argv[2];
const url = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

  // Record every line the app speaks, so we can check none of them is a command the app could hear itself say.
  await page.addInitScript(() => {
    window.__spoken = [];
    if (window.speechSynthesis) {
      const orig = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); try { orig(u); } catch (_) {} };
    }
  });

  await page.addInitScript(() => { try { if (!localStorage.getItem('cookalong.settings.v1')) localStorage.setItem('cookalong.settings.v1', JSON.stringify({ setupDone: true })); } catch (_) { /* ignore */ } });
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '00-library.png') });
  await page.click('[data-tap="open:dal-tadka"]');
  await page.waitForTimeout(200);
  const fontsOk = await page.evaluate(() => [document.fonts.check('800 64px "Atkinson Hyperlegible Next"'), document.fonts.check('700 76px "Atkinson Hyperlegible Mono"')]);
  check('bundled fonts load', fontsOk[0] && fontsOk[1], JSON.stringify(fontsOk));

  const C = (fn, ...args) => page.evaluate(fn, ...args);
  const voice = (intent, extra = {}) => C(([i, e]) => { const c = window.__cookAlong; c.handleIntent({ intent: i, word: e.word || i, heard: e.heard || i, ...e }, { kind: 'voice', word: e.word || i, heard: e.heard || e.word || i }); c.render(); }, [intent, extra]);
  const shot = async (name) => { await page.waitForTimeout(260); await page.screenshot({ path: path.join(outDir, name + '.png') }); };
  // Cards that must never clip or spill their content.
  const overflow = () => C(() => {
    const bad = [];
    document.querySelectorAll('#stage .stepcard, #stage .timer, #stage .beatnow, #stage .sheet .card, #stage .alert, #stage .gesture-hud, #stage .then, #stage .bottom, #stage .ing-card, #stage .serves').forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className.split(' ')[0]} ${el.scrollWidth}x${el.scrollHeight} > ${el.clientWidth}x${el.clientHeight}`);
    });
    const stage = document.getElementById('stage').getBoundingClientRect();
    document.querySelectorAll('#stage *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > stage.right + 1 || r.bottom > stage.bottom + 1)) bad.push(`outside stage: ${el.tagName}.${el.className}`);
    });
    return bad.slice(0, 6);
  });
  const noOverflow = async (label) => { const o = await overflow(); check(`no overflow: ${label}`, o.length === 0, o.join(' | ')); };

  // ---- start screen
  await shot('01-start');
  await noOverflow('start');
  await page.click('[data-tap="plus"]');
  await page.click('[data-tap="minus"]');
  const servings = await C(() => window.__cookAlong.S.servings);
  check('servings stepper taps work', servings === 4, String(servings));
  // Sensors are off in the test browser; the pills are set by hand for the screenshots.
  await page.uncheck('[data-flag="mic"]');
  await page.uncheck('[data-flag="camera"]');
  await page.click('[data-tap="start"]');
  await C(() => { const S = window.__cookAlong.S; S.voiceState = 'listening'; S.camState = 'on'; });
  await shot('02-step1');
  await noOverflow('step 1');

  // ---- churn: in far mode only the timer rail should change while idle
  const churn = await C(() => new Promise((resolve) => {
    const counts = {};
    const mo = new MutationObserver((list) => { for (const m of list) { const slot = m.target.closest('[id^="L"]'); const id = slot ? slot.id : 'other'; counts[id] = (counts[id] || 0) + 1; } });
    mo.observe(document.getElementById('stage'), { childList: true, subtree: true, characterData: true, attributes: true });
    setTimeout(() => { mo.disconnect(); resolve(counts); }, 2100);
  }));
  check('idle ticks only touch the timer rail', Object.keys(churn).every((k) => k === 'Lrail' || k === 'Ltop'), JSON.stringify(churn));

  // ---- walk to step 4 (checklist) and tick items with "ho gaya"
  for (let i = 0; i < 3; i++) await voice('next', { word: 'aage' });
  const at4 = await C(() => window.__cookAlong.S.step);
  check('three "aage" reach step 4', at4 === 3, String(at4));
  await voice('ack', { word: 'ho gaya' });
  await voice('ack', { word: 'ho gaya' });
  await shot('03-checklist');
  await noOverflow('checklist');
  const ticks = await C(() => Object.keys(window.__cookAlong.S.checked).length);
  check('"ho gaya" ticks checklist items', ticks === 2, String(ticks));
  await voice('undo', { word: 'galat' });
  const ticksAfterUndo = await C(() => Object.keys(window.__cookAlong.S.checked).filter((k) => window.__cookAlong.S.checked[k]).length);
  check('"galat" un-ticks the last item', ticksAfterUndo === 1, String(ticksAfterUndo));
  await voice('ack', { word: 'ho gaya', heard: 'garlic ho gaya' });
  const garlic = await C(() => !!window.__cookAlong.S.checked['3:3'] && !window.__cookAlong.S.checked['3:1']);
  check('"garlic ho gaya" ticks the garlic, not the next item', garlic);
  const row = await (await page.$('[data-hold="tick:1"]')).boundingBox();
  await page.mouse.move(row.x + 60, row.y + row.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  const held = await C(() => !!window.__cookAlong.S.checked['3:1']);
  check('a half-second knuckle hold ticks a row', held);
  await shot('03b-checklist-ticked');

  // ---- undo keeps time: move on, wait, undo, the soaking timer should not jump back
  await C(() => { window.__cookAlong.S.speed = 30; });
  const before = await C(() => window.__cookAlong.S.timers.rice.endsAt);
  await voice('next', { word: 'aage' }); // step 5 starts the rice: replaces the soak timer
  const replaced = await C(() => window.__cookAlong.S.timers.rice.sub);
  await page.waitForTimeout(600);
  await voice('undo', { word: 'galat' });
  const after = await C(() => ({ endsAt: window.__cookAlong.S.timers.rice.endsAt, sub: window.__cookAlong.S.timers.rice.sub, step: window.__cookAlong.S.step }));
  check('undo restores the replaced timer, still counting', after.endsAt === before && after.sub.includes('soaking') && replaced.includes('low flame') && after.step === 3, JSON.stringify({ before, after, replaced }));
  await C(() => { window.__cookAlong.S.speed = 1; });

  // ---- step 6, onions, whistles, far layout
  await voice('next', { word: 'aage' });
  await voice('next', { word: 'aage' });
  await C(() => { const c = window.__cookAlong; c.addWhistle('test'); c.addWhistle('test'); c.S.echo = null; c.S.notice = null; c.render(); });
  await shot('04-step6-far');
  await noOverflow('step 6');
  await voice('next', { word: 'aage' });
  await shot('05-step7-echo');
  const echoText = await C(() => document.querySelector('.echo .t') && document.querySelector('.echo .t').textContent);
  check('voice command is echoed with what was heard', /Heard “aage”: moved to step 7/.test(echoText || ''), echoText);

  // ---- how much: answer is visible even with an echo up
  await voice('howmuch', { heard: 'namak kitna' });
  const banner = await C(() => document.querySelector('.banner .t') && document.querySelector('.banner .t').textContent);
  check('"namak kitna" shows the answer', /Salt/.test(banner || ''), banner);

  // ---- loud
  await page.keyboard.press('l');
  await C(() => { const c = window.__cookAlong; c.S.echo = null; c.S.notice = null; c.render(); });
  await shot('06-loud');
  const ignoredLoud = await C(() => { const c = window.__cookAlong; const s0 = c.S.step; return s0; });
  await page.keyboard.press('l');

  // ---- gesture HUD over the step card
  await C(() => { const c = window.__cookAlong; c.S.engaged = true; c.S.engagedAt = Date.now(); c.render(); });
  await shot('07-gesture');
  await noOverflow('gesture hud');
  await C(() => { const c = window.__cookAlong; c.S.engaged = false; c.render(); });

  // ---- third whistle: alert, "aage" must not skip it, voice ack clears it
  await C(() => window.__cookAlong.addWhistle('test'));
  await shot('08-alert');
  await page.waitForTimeout(800);
  await shot('08b-alert-rest');
  const alertOpacity = await C(() => getComputedStyle(document.getElementById('Lalert')).opacity);
  check('alert is fully opaque once shown', alertOpacity === '1', alertOpacity);
  await noOverflow('alert');
  await voice('next', { word: 'aage' });
  const stillAlert = await C(() => !!window.__cookAlong.S.alert);
  check('"aage" does not dismiss a safety alert', stillAlert);
  const alertChurn = await C(() => new Promise((resolve) => {
    const el = document.querySelector('#Lalert');
    let restarts = 0;
    const mo = new MutationObserver(() => { if (el.classList.contains('enter') && el.getAnimations().some((a) => a.currentTime < 50)) restarts++; });
    mo.observe(el, { childList: true, subtree: true });
    setTimeout(() => { mo.disconnect(); resolve(restarts); }, 1500);
  }));
  check('alert does not re-animate while its timers tick', alertChurn === 0, String(alertChurn));
  await voice('ack', { word: 'ho gaya' });
  const cooling = await C(() => window.__cookAlong.S.timers.dal.type);
  check('ack turns the dal into a cooling timer', cooling === 'cooling', cooling);

  // ---- near mode and a half-second hold
  await page.keyboard.press('n');
  await C(() => { const c = window.__cookAlong; c.S.echo = null; c.S.notice = null; c.render(); });
  await shot('09-near');
  await noOverflow('near');
  const stepBeforeHold = await C(() => window.__cookAlong.S.step);
  const box = await (await page.$('[data-hold="next"]')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  const afterTap = await C(() => window.__cookAlong.S.step);
  check('a quick tap does not move the step', afterTap === stepBeforeHold, `${stepBeforeHold} -> ${afterTap}`);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await shot('10-near-holding');
  await page.waitForTimeout(400);
  await page.mouse.up();
  const afterHold = await C(() => window.__cookAlong.S.step);
  check('a half-second hold moves one step', afterHold === stepBeforeHold + 1, `${stepBeforeHold} -> ${afterHold}`);
  await page.keyboard.press('n');

  // ---- cooker still cooling: step 9 is blocked, "haan" overrides
  await C(() => { const c = window.__cookAlong; c.S.echo = null; c.render(); });
  await voice('next', { word: 'aage' });
  await shot('11-blocked');
  const blocked = await C(() => ({ step: window.__cookAlong.S.step, notice: document.querySelector('.banner .t') && document.querySelector('.banner .t').textContent }));
  check('step 9 waits for the cooker', blocked.step === 7 && /cooling/.test(blocked.notice || ''), JSON.stringify(blocked));
  await voice('yes', { word: 'haan' });
  const forced = await C(() => window.__cookAlong.S.step);
  check('"haan" overrides the wait', forced === 8, String(forced));
  await voice('undo', { word: 'galat' });
  await C(() => { const c = window.__cookAlong; c.S.timers.dal.endsAt = c.S.clock + 200; });
  await page.waitForTimeout(700);
  const safe = await C(() => window.__cookAlong.S.timers.dal.state);
  check('cooling timer finishes into "safe to open"', safe === 'done', safe);

  // ---- rescale at step 8
  await voice('servings', { servings: 6, heard: '6 logon ke liye', word: '6 logon ke liye' });
  await shot('12-scale');
  await noOverflow('scale sheet');
  await voice('no', { word: 'nahi' });
  const kept = await C(() => window.__cookAlong.S.servings);
  check('"nahi" keeps the servings', kept === 4, String(kept));

  // ---- tadka beats
  await voice('next', { word: 'aage' }); // step 9
  await voice('next', { word: 'aage' }); // step 10, beat 1
  await shot('13-tadka-beat1');
  await noOverflow('tadka beat 1');
  await voice('ack', { word: 'ho gaya' }); // ghee hot -> jeera
  await page.waitForTimeout(1200);
  await shot('14-tadka-beat2');
  const beat = await C(() => [window.__cookAlong.S.step, window.__cookAlong.S.beat]);
  check('"ho gaya" moves the waiting beat on', beat[0] === 9 && beat[1] === 1, JSON.stringify(beat));
  await voice('undo', { word: 'galat' });
  const beatUndo = await C(() => [window.__cookAlong.S.step, window.__cookAlong.S.beat]);
  check('"galat" goes back one beat, not one step', beatUndo[0] === 9 && beatUndo[1] === 0, JSON.stringify(beatUndo));

  // ---- recap and help
  await page.keyboard.press('a');
  await C(() => { window.__cookAlong.S.awaySince = Date.now() - 3 * 60000; });
  await page.keyboard.press('a');
  await shot('15-recap');
  await noOverflow('recap');
  await page.keyboard.press('Enter');
  await voice('help', { word: 'madad' });
  await shot('16-help');
  await noOverflow('help');
  await page.keyboard.press('Enter');

  // ---- stop asks first
  await voice('stop', { word: 'cooking band karo' });
  const stillCooking = await C(() => window.__cookAlong.S.screen);
  check('"cooking band karo" asks before ending', stillCooking === 'cook', stillCooking);
  await voice('no', { word: 'nahi' });

  // ---- finish
  await C(() => { const c = window.__cookAlong; c.goToStep(10, { force: true }); c.next({ kind: 'key' }); c.render(); });
  await shot('17-done');
  await noOverflow('done');
  await C(() => { const c = window.__cookAlong; c.S.notes.unshift('Agli baar namak thoda kam'); c.S.screen = 'start'; c.render(); });
  await shot('18-start-with-note');
  await noOverflow('start with a saved note');
  const note = await C(() => document.querySelector('.lastnote .t') && document.querySelector('.lastnote .t').textContent);
  check('the saved note shows before the next cook', /namak thoda kam/.test(note || ''), note);

  // ---- parser
  const cases = {
    'aage': 'next', 'Aage chalo': 'next', 'peeche': 'back', 'ho gaya': 'ack', 'namak kitna dalna hai': 'howmuch',
    '5 minute ka timer': 'timer', 'set a 10 minute timer': 'timer', '6 logon ke liye': 'servings', 'galat': 'undo', 'phir se': 'repeat',
    'ruko': 'pause', 'आगे': 'next', 'हो गया': 'ack', 'cooking band karo': 'stop', 'ek aur seeti': 'whistle',
    'the TV is on': null, 'gas band karo': null, '5 minute mein aata hoon': null, 'ek aur roti do': null, 'about 10 min': null,
  };
  const parsed = await C((cs) => Object.fromEntries(Object.keys(cs).map((t) => [t, (window.__cookAlong.parseCommand(t) || {}).intent || null])), cases);
  for (const [t, want] of Object.entries(cases)) check(`parse "${t}"`, parsed[t] === want, `got ${parsed[t]}`);

  // ---- the app must never say a command word out loud
  const spoken = await C(() => window.__spoken || []);
  const selfTriggers = await C((lines) => lines.map((l) => [l, (window.__cookAlong.parseCommand(l) || {}).intent || null]).filter(([, i]) => i), spoken);
  check(`spoken lines contain no commands (${spoken.length} lines)`, selfTriggers.length === 0, JSON.stringify(selfTriggers));

  const recipeSelf = await C(async () => {
    const R = await import('/recipe.js');
    const D = R.DAL_TADKA;
    const lines = [];
    for (const st of D.steps) {
      lines.push(st.say ? R.fill(D, st.say, 4) : `${R.fill(D, st.headline, 4)}. ${st.detail ? R.fill(D, st.detail, 4) : ''}`);
      for (const b of st.beats || []) { lines.push(b.say); lines.push(b.sayHi); }
    }
    return lines.map((l) => [l, (window.__cookAlong.parseCommand(l) || {}).intent || null]).filter(([, i]) => i);
  });
  check('recipe lines, English and Hindi, contain no commands', recipeSelf.length === 0, JSON.stringify(recipeSelf));

  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.detail}]`}`).join('\n'));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.writeFileSync(path.join(outDir, 'spoken.txt'), spoken.join('\n'));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
