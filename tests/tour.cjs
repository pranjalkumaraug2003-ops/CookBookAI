// Walks the reviewer tour from start to finish: every stop renders, simulated input is labelled as such,
// nothing overflows, and nothing is saved.   node tests/tour.cjs <screenshot dir> <base url>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const outDir = process.argv[2];
const base = (process.argv[3] || 'http://localhost:8000').replace(/\/$/, '');
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/index.html?nosw&tour=1`, { waitUntil: 'load' });
  await page.waitForSelector('#tourBar .tour-t');
  const C = (fn, ...a) => page.evaluate(fn, ...a);
  const count = await C(() => window.__cookAlong.tour.count);
  const overflowAll = [];
  let simulatedEcho = false;
  let barOverStage = false;
  for (let k = 0; k < count; k++) {
    await page.waitForTimeout(3200);
    const st = await C(() => {
      const bar = document.getElementById('tourBar').getBoundingClientRect();
      const stage = document.getElementById('stage').getBoundingClientRect();
      const bad = [];
      document.querySelectorAll('#stage .stepcard, #stage .timer, #stage .alert, #stage .bottom, #stage .beatnow, #stage .sheet .card').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) bad.push(el.className.split(' ')[0]);
      });
      return {
        title: document.querySelector('#tourBar .tour-t').textContent,
        echo: (document.querySelector('.echo .t') || {}).textContent || '',
        overlap: stage.top < bar.bottom - 1,
        bad,
        screen: window.__cookAlong.S.screen,
      };
    });
    if (st.echo.startsWith('Simulated')) simulatedEcho = true;
    if (/^Heard/.test(st.echo)) check(`stop ${k + 1}: simulated input is not shown as heard`, false, st.echo);
    if (st.overlap) barOverStage = true;
    if (st.bad.length) overflowAll.push(`${k + 1}:${st.bad.join(',')}`);
    await page.screenshot({ path: path.join(outDir, `t${String(k + 1).padStart(2, '0')}.png`) });
    if (k < count - 1) await page.click('[data-tour="next"]');
  }
  check('tour: every stop renders', true);
  check('tour: simulated voice is labelled "Simulated"', simulatedEcho);
  check('tour: the bar never covers the app', !barOverStage);
  check('tour: no card overflows at any stop', overflowAll.length === 0, overflowAll.join(' | '));
  const saved = await C(() => localStorage.getItem('cookalong.session.v1'));
  check('tour: nothing is saved as a cook in progress', saved === null, String(saved).slice(0, 80));
  await page.click('[data-tour="exit"]');
  const after = await C(() => ({ screen: window.__cookAlong.S.screen, demo: !!window.__cookAlong.S.demo, bar: document.getElementById('tourBar').innerHTML.length, voice: window.__cookAlong.S.flags.voice }));
  check('tour: finishing returns to the library with settings restored', after.screen === 'library' && !after.demo && after.bar === 0 && after.voice === true, JSON.stringify(after));
  check('tour: no page errors', errors.length === 0, errors.join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.detail}]`}`).join('\n'));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
