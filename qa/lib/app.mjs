// Driving the real app from a test: open it with chosen settings, start a cook, read its state.
// Uses the test hook the app already exposes (window.__cookAlong); never changes app code.
import { settingsScript, sleep } from './common.mjs';

export async function openApp(page, base, flags) {
  await page.addInitScript(settingsScript(flags));
  await page.goto(`${base}/index.html?nosw`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__cookAlong && window.__cookAlong.S, null, { timeout: 20000 });
}

// Starts the built-in dal tadka and moves to step `step` (0-based) without speaking.
export async function startCook(page, step = 0) {
  await page.evaluate((st) => {
    const c = window.__cookAlong;
    c.openRecipe(c.store.getRecipe('dal-tadka'));
    c.S.servings = 4;
    c.startCooking();
    for (let k = 1; k <= st; k++) c.goToStep(k, { force: true, quiet: true });
    c.render();
  }, step);
}

export const snap = (page) => page.evaluate(() => {
  const S = window.__cookAlong.S;
  return {
    t: Date.now(), screen: S.screen, step: S.step, alert: S.alert ? S.alert.title : null, sheet: S.sheet ? (S.sheet.kind || S.sheet.type || 'open') : null,
    engaged: !!S.engaged, arm: S.armProgress == null ? null : Math.round(S.armProgress * 100) / 100,
    echo: S.echo ? { text: S.echo.text, created: S.echo.created } : null,
    notice: S.notice ? S.notice.text : null,
    cam: S.camState, mic: S.micState, voice: S.voiceState, muted: !!S.muted,
    face: S.faceRatio == null ? null : Math.round(S.faceRatio * 1000) / 1000, near: !!S.nearAuto, loud: !!S.loudAuto,
    level: S.level ? { db: Math.round(S.level.db * 10) / 10, floor: Math.round(S.level.floor * 10) / 10, ratio: Math.round(S.level.ratio * 100) / 100 } : null,
    speaking: 'speechSynthesis' in window ? speechSynthesis.speaking : false,
    log: S.log.slice(0, 20),
  };
});

// Waits for a sensor to finish starting. Returns { state, ms }.
export async function waitState(page, key, done = ['on', 'unavailable', 'blocked', 'unsupported', 'error', 'listening'], timeoutMs = 90000) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate((k) => window.__cookAlong.S[k], key);
    if (done.includes(v)) return { state: v, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { state: v, ms: Date.now() - t0, timedOut: true };
    await sleep(200);
  }
}

// Collects the app's log lines (newest first in the app) into one ordered, de-duplicated list.
export class LogWatch {
  constructor() { this.seen = new Set(); this.lines = []; }
  add(lines) {
    for (const l of [...lines].reverse()) if (!this.seen.has(l)) { this.seen.add(l); this.lines.push(l); }
  }
  since(n) { return this.lines.slice(n); }
}

// Raises the "turn off the flame" alert the way a real cook does: three whistles on the cooker step.
export async function raiseCookerAlert(page) {
  await page.evaluate(() => {
    const c = window.__cookAlong;
    c.startCooking();
    for (let k = 1; k <= 2; k++) c.goToStep(k, { force: true, quiet: true });
    for (let i = 0; i < 3; i++) c.addWhistle('qa');
    c.render();
  });
}
