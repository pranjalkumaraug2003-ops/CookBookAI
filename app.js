// Cook-Along Mode: state, timers, inputs and rendering for the cooking screens.
// The library, import and review screens live in library.js; the recipe format in recipe.js.
import { DAL_TADKA, LANES, VESSEL_NAMES, fill, fillSafe, fmtQty, scaledQty, findIngredientByWord, potOf, laneOf, idsInStep, hasWhistles, escapeHtml as esc } from './recipe.js';
import { createRecognizer, parseCommand, speak, stopSpeaking, isSpeaking, spokeWithin, VOCABULARY } from './voice.js';
import { startCamera, loadVision, runVisionLoop, GestureInterpreter, NearDetector, startMic, chime, unlockAudio, keepScreenOn } from './sensing.js';
import { I, svg, vesselIcon } from './icons.js';
import * as store from './store.js';
import { createVideo, fmtTime } from './video.js';
import { libraryScreens } from './library.js';
import { createTour } from './tour.js';

const stage = document.getElementById('stage');
const demoEl = document.getElementById('demo');
const camEl = document.getElementById('cam');
const now = () => performance.now();

// ---------------------------------------------------------------- state
const S = {
  screen: 'library',
  recipe: DAL_TADKA,
  servings: 4,
  flags: { voice: true, camera: true, mic: true, readAloud: true, lang: 'en-IN', video: true },
  step: 0,
  beat: 0,
  beatRemaining: null,
  beatPaused: false,
  entered: {},
  checked: {},
  timers: {},
  alert: null,
  notice: null,
  echo: null,
  history: [],
  events: [],
  warned: {},
  speed: 1,
  clock: 0, // cooking time in ms; runs faster with the demo speed so timers can be skipped through
  nearAuto: false,
  nearOverride: null,
  loudAuto: false,
  loudOverride: null,
  voiceState: 'off',
  camState: 'off',
  micState: 'off',
  armProgress: null,
  engaged: false,
  holding: null,
  pendingConfirm: null,
  pendingScale: null,
  sheet: null,
  awaySince: null,
  notes: [],
  level: { db: -90, floor: -90, ratio: 0 },
  log: [],
  video: { waiting: false, error: null, time: 0 },
  needsTouch: false,
  online: navigator.onLine !== false,
};
// Sensing thresholds. These are starting guesses: tune them in the demo panel with your own cooker, kitchen and camera.
// Tuned values are saved on this device, so the next cook starts with them.
const CFG = { loudDb: -38, whistleDb: -32, whistleRatio: 0.5, whistleLowHz: 2000, whistleHighHz: 6000, nearEnter: 0.3 };

const R = () => S.recipe;
const STEPS = () => R().steps;
// Without a camera the app can't tell how close you are, so the elbow targets stay on rather than vanish.
const noCamera = () => S.camState === 'off' || S.camState === 'unavailable';
const isNear = () => (S.nearOverride ?? (noCamera() ? true : S.nearAuto));
const isLoud = () => (S.loudOverride ?? S.loudAuto);
const step = () => STEPS()[S.step];
const lane = (potId) => laneOf(R(), potId);
const potName = (potId) => { const p = potOf(R(), potId); return p ? p.name : 'Pot'; };
const vesselName = (potId) => { const p = potOf(R(), potId); return p ? VESSEL_NAMES[p.vessel] || p.vessel : 'pot'; };
const potIcon = (potId, s, c) => { const p = potOf(R(), potId); return vesselIcon(p ? p.vessel : 'pot', s, c); };
const T = (text, mode) => fillSafe(R(), text, S.servings, mode);
const Tplain = (text) => fill(R(), text, S.servings);

function log(line) {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  S.log.unshift(`${t}  ${line}`);
  S.log.length = Math.min(S.log.length, 40);
  if (demoEl.classList.contains('open')) renderDemoLog();
}

function addEvent(pot, text) { S.events.push({ t: Date.now(), pot, text }); if (S.events.length > 60) S.events.shift(); }

// ---------------------------------------------------------------- timers
// Timers store when they end on the cooking clock, so undo can put an old timer back without losing time.
// A timer's `then` says what happens when it ends (a notice, an alert, a follow-on timer); it is plain data,
// so timers survive a reload.
function makeTimer(spec) {
  const t = { slot: spec.slot, type: spec.type, label: spec.label, sub: spec.sub, ask: spec.ask || null, then: spec.then || null, opens: !!spec.opens, state: 'running', created: Date.now() };
  if (spec.type === 'whistle') { t.target = spec.target; t.count = 0; t.times = []; }
  else { t.totalMs = spec.minutes * 60000; t.endsAt = S.clock + t.totalMs; }
  return t;
}
const left = (t) => Math.max(0, t.endsAt - S.clock);

function fmtClock(ms, pad = true) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = String(s % 60).padStart(2, '0');
  return pad ? `${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

let lastTick = now();
function tick() {
  const t = now();
  const dt = t - lastTick;
  lastTick = t;
  if (S.screen === 'cook') {
    S.clock += dt * S.speed;
    for (const tm of Object.values(S.timers)) {
      if (tm.type === 'whistle' || tm.state === 'done' || tm.state === 'due') continue;
      const rem = left(tm);
      if (rem <= 30000 && tm.state === 'running') tm.state = 'soon';
      if (rem <= 0) timerDone(tm);
    }
    checkCollisions();
    tickBeat(dt);
    tickVideo();
    if (S.alert && t >= S.alert.nextChimeAt) {
      S.alert.level += 1;
      S.alert.nextChimeAt = t + 15000;
      chime(laneChime(S.alert.pot), S.alert.level);
      if (S.alert.level % 2 === 0) say(S.alert.title);
    }
    persist();
  }
  if (S.echo && Date.now() > S.echo.until) S.echo = null;
  if (S.notice && Date.now() > S.notice.until) S.notice = null;
  if (S.sheet && S.sheet.until && Date.now() > S.sheet.until) S.sheet = null;
  // Screens with real buttons and text boxes only re-render on input; re-rendering mid-click or mid-typing would swallow it.
  if (!S.holding && !['start', 'library', 'add', 'review'].includes(S.screen)) render();
}

const laneChime = (potId) => { const l = lane(potId); return l ? l.chime : 'soft'; };
const ordinal = (n) => ({ 1: '1st', 2: '2nd', 3: '3rd' }[n] || `${n}th`);

function timerDone(tm) {
  const o = tm.then || {};
  if (o.alert) {
    tm.state = 'due';
    raiseAlert({ pot: tm.slot, ...o.alert, sub: (o.alert.sub || 'Timer done').replace('{ordinal}', ordinal(tm.count || 0)) });
  } else if (tm.type === 'checkin' && !o.doneText) {
    tm.state = 'due';
    const text = tm.ask ? `Check the ${tm.label.toLowerCase()}` : `${tm.label} is up`;
    notify({ pot: tm.slot, text, sub: tm.ask ? `${tm.ask} Say “ho gaya” once it is.` : '', speakIt: true, spoken: tm.ask ? `${text}. ${tm.ask}` : text });
  } else {
    tm.state = 'done';
    tm.doneText = o.doneText || 'Done';
    if (o.notify) notify({ pot: tm.slot, text: o.notify.text, sub: o.notify.sub || '', speakIt: o.notify.speak });
    else notify({ pot: tm.slot, text: `${tm.label} timer done`, sub: '' });
  }
  addEvent(tm.slot, `${tm.label}: ${tm.doneText || 'needs you'}`);
  persistNow();
}

function checkCollisions() {
  const live = Object.values(S.timers).filter((t) => t.type !== 'whistle' && (t.state === 'running' || t.state === 'soon'));
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]; const b = live[j];
      const key = [a.slot, b.slot, a.created, b.created].join(':');
      if (S.warned[key]) continue;
      const first = left(a) <= left(b) ? a : b;
      const second = first === a ? b : a;
      if (Math.abs(left(a) - left(b)) < 60000 && left(first) < 120000 && left(first) > 20000) {
        S.warned[key] = true;
        notify({ pot: first.slot, text: `${first.label} and ${second.label.toLowerCase()} finish together`, sub: `Handle the ${first.label.toLowerCase()} first.`, speakIt: true });
      }
    }
  }
}

const whistleTimer = () => Object.values(S.timers).find((t) => t.type === 'whistle' && t.state === 'running') || null;

function addWhistle(source) {
  const tm = whistleTimer();
  if (!tm) return false;
  tm.count += 1;
  tm.times.push(Date.now());
  log(`whistle ${tm.count}/${tm.target} (${source})`);
  addEvent(tm.slot, `Whistle ${tm.count} of ${tm.target}`);
  if (tm.count >= tm.target) {
    tm.state = 'due';
    const o = (tm.then && tm.then.alert) || {
      kicker: `${potName(tm.slot)} · cooker`, title: 'Turn off the flame', body: "Let the pressure drop by itself, about 10 min. Don't open the lid yet.",
      next: { slot: tm.slot, type: 'cooling', label: tm.label, sub: 'cooker · flame off, cooling', minutes: 10, opens: true, then: { doneText: 'Safe to open', notify: { text: `${potName(tm.slot)}: safe to open the cooker`, sub: 'The pressure has dropped.' } } },
    };
    raiseAlert({ pot: tm.slot, ...o, sub: `${ordinal(tm.count)} whistle heard just now` });
  } else {
    chime(laneChime(tm.slot), 0);
    // Spoken lines avoid command words ("seeti", "whistle"), so the app can't hear itself and count again.
    say(`${tm.label}, ${tm.count} of ${tm.target}`);
  }
  persistNow();
  return true;
}

// ---------------------------------------------------------------- feedback
// Imported recipes are written by people and models, so their spoken lines are checked: a step that says
// "wait" or "done" out loud would be heard by the app as a command.
const SPOKEN_SWAPS = [
  [/\bstop cooking\b/gi, 'turn off the heat'], [/\bwait\b/gi, 'hold on'], [/\bpause\b/gi, 'hold'], [/\bdone\b/gi, 'ready'],
  [/\bwrong\b/gi, 'off'], [/\bundo\b/gi, 'reverse'], [/\bnext\b/gi, 'then'], [/\bback\b/gi, 'over'], [/\bprevious\b/gi, 'earlier'],
  [/\bagain\b/gi, 'once more'], [/\brepeat\b/gi, 'do once more'], [/\bcontinue\b/gi, 'keep going'], [/\bresume\b/gi, 'pick up'],
  [/\bhelp\b/gi, 'aid'], [/\bwhistle\b/gi, 'pressure release'], [/\byes\b/gi, 'right'], [/\bno\b/gi, 'not a'],
];
export function safeSpoken(text) {
  let t = String(text || '');
  for (let i = 0; i < 4 && parseCommand(t); i++) for (const [re, sub] of SPOKEN_SWAPS) t = t.replace(re, sub);
  return parseCommand(t) ? '' : t;
}

function say(text, hindi) {
  if (!S.flags.readAloud) return;
  const line = safeSpoken(text);
  if (line) speak(line, { hindi });
}

function notify({ pot, text, sub, speakIt, spoken }) {
  S.notice = { created: Date.now(), pot, text, sub, until: Date.now() + 8000 };
  chime(laneChime(pot), 0);
  if (speakIt) say(spoken || `${text}. ${sub || ''}`);
}

function echo(via, text, { undoable = true } = {}) {
  const heard = via.sim ? `Simulated “${via.word || via.heard}”: ` : via.kind === 'voice' ? `Heard “${via.word || via.heard}”: ` : via.kind === 'gesture' ? `${via.label}: ` : via.kind === 'hold' ? 'Held: ' : '';
  S.echo = { created: Date.now(), text: heard + text, undoable, until: Date.now() + 5000 };
}

function raiseAlert(a) {
  stopSpeaking();
  if (videoCtl && videoCtl.playing()) { videoCtl.pause(); log('video paused for an alert'); }
  S.alert = { pot: a.pot, kicker: a.kicker || `${potName(a.pot)} · ${vesselName(a.pot)}`, sub: a.sub || '', title: a.title, body: a.body || '', next: a.next || null, level: 0, nextChimeAt: now() + 15000, since: Date.now() };
  addEvent(a.pot, `${S.alert.kicker.split(' · ')[0]}: ${a.title}`);
  chime(laneChime(a.pot), 0);
  say(`${S.alert.kicker.split(' · ')[0]}. ${a.title}. ${a.body}`);
  log(`alert: ${a.title}`);
  persistNow();
}

function ackAlert(via) {
  const a = S.alert;
  if (!a) return false;
  S.alert = null;
  if (a.next) S.timers[a.next.slot] = makeTimer(a.next);
  stopSpeaking();
  echo(via, `cleared “${a.title.toLowerCase()}”`, { undoable: false });
  log('alert cleared');
  persistNow();
  return true;
}

// ---------------------------------------------------------------- navigation
// The timer map is copied, not the timers: undoing a step puts back the timer it replaced, still counting.
function snapshot() {
  return { step: S.step, beat: S.beat, entered: { ...S.entered }, checked: { ...S.checked }, timers: { ...S.timers }, servings: S.servings };
}

function pushHistory() {
  S.history.push(snapshot());
  if (S.history.length > 20) S.history.shift();
}

function restore(snap) {
  S.step = snap.step; S.beat = snap.beat; S.entered = snap.entered; S.checked = snap.checked; S.timers = snap.timers; S.servings = snap.servings;
  S.beatRemaining = null; S.beatPaused = false;
  if (step().beats) startBeat(snap.beat, { quiet: true });
}

// A pot is ready when its current timer says so (a cooled cooker is safe to open).
function potReady(potId) {
  const t = S.timers[potId];
  return !!(t && t.opens && t.state === 'done');
}

function waitReason(potId) {
  const t = S.timers[potId];
  const name = potName(potId).toLowerCase();
  if (!t || t.type === 'whistle') return `The ${name} hasn't finished its whistles yet`;
  if (t.type === 'cooling') return `The cooker is still cooling, about ${Math.max(1, Math.ceil(left(t) / 60000))} min`;
  return `The ${name} isn't ready yet`;
}

function askToConfirm(text, sub, action, pot = 'soft') {
  S.pendingConfirm = { action, until: Date.now() + 15000 };
  S.notice = { created: Date.now(), pot, text, sub, until: Date.now() + 15000 };
}

function goToStep(i, { force = false, via = { kind: 'key' }, quiet = false } = {}) {
  if (i < 0 || i >= STEPS().length) return;
  const target = STEPS()[i];
  if (target.waitFor && !force && !potReady(target.waitFor)) {
    const why = waitReason(target.waitFor);
    askToConfirm(why, 'Say “haan” to go ahead anyway, or wait for my call.', () => goToStep(i, { force: true, via }), target.waitFor);
    // The spoken line leaves out "haan", so the app's own voice can't confirm the override.
    say(`${why}. I'll tell you when it's safe to open.`);
    return;
  }
  pushHistory();
  S.pendingConfirm = null;
  S.step = i;
  S.beat = 0;
  S.beatRemaining = null;
  S.beatPaused = false;
  if (!S.entered[i]) {
    S.entered[i] = true;
    (target.onEnter || []).forEach((spec) => { S.timers[spec.slot] = makeTimer(spec); });
  }
  if (!quiet) echo(via, `moved to step ${i + 1}`);
  if (target.beats) startBeat(0);
  else if (!videoOn()) speakStep();
  videoToStep(true);
  headsUp(i);
  log(`step ${i + 1}`);
  persistNow();
}

// "Warn before, not during": a step that can't be paused is announced one step early.
function headsUp(i) {
  const nx = STEPS()[i + 1];
  if (!nx || !nx.fast || nx.beats) return;
  const names = idsInStep(R(), nx).map((id) => R().ingredients[id].name.toLowerCase());
  S.notice = { created: Date.now() + 1, pot: nx.pot || 'soft', text: 'Heads up: the next step moves fast', sub: names.length ? `Get these ready now: ${names.slice(0, 5).join(', ')}.` : 'Get everything for it ready now.', until: Date.now() + 9000 };
}

const spokenUnits = (t) => t.replace(/\btbsp\b/g, 'tablespoon').replace(/\btsp\b/g, 'teaspoon').replace(/\bg\b/g, 'grams').replace(/\bml\b/g, 'millilitres');
function spokenStep(st) {
  return spokenUnits(st.say ? Tplain(st.say) : `${Tplain(st.headline)}. ${st.detail ? Tplain(st.detail) : ''}`);
}
function speakStep() { say(spokenStep(step())); }

function next(via = { kind: 'key' }) {
  if (S.screen !== 'cook') return;
  if (S.alert) return;
  if (S.sheet) { closeSheet(); return; }
  const st = step();
  if (st.beats && S.beat < st.beats.length - 1) { pushHistory(); startBeat(S.beat + 1); echo(via, `beat ${S.beat + 1}`); return; }
  if (S.step === STEPS().length - 1) { finish(); return; }
  goToStep(S.step + 1, { via });
}

function back(via = { kind: 'key' }) {
  if (S.screen !== 'cook' || S.alert) return;
  if (S.sheet) { closeSheet(); return; }
  const st = step();
  if (st.beats && S.beat > 0) { pushHistory(); startBeat(S.beat - 1); echo(via, `back to beat ${S.beat + 1}`); return; }
  if (S.step === 0) return;
  // Going back is for re-reading: timers keep running and nothing is restarted.
  pushHistory();
  S.step -= 1;
  S.beat = 0;
  S.beatRemaining = null;
  echo(via, `back to step ${S.step + 1}`);
  if (step().beats) startBeat(0); else if (!videoOn()) speakStep();
  videoToStep(true);
  persistNow();
}

function undo(via) {
  const snap = S.history.pop();
  if (!snap) { echo(via, 'nothing to undo', { undoable: false }); return; }
  stopSpeaking();
  restore(snap);
  const where = step().beats ? `beat ${S.beat + 1} of the ${Tplain(step().headline).toLowerCase()}` : `step ${S.step + 1}`;
  echo(via, `undone, back on ${where}`, { undoable: false });
  if (!step().beats && !videoOn()) speakStep();
  videoToStep(false);
  persistNow();
}

function finish() {
  S.screen = 'done';
  S.alert = null;
  S.sheet = null;
  S.pendingConfirm = null;
  stopSpeaking();
  closeVideo();
  const flames = R().pots.length === 1 ? 'the flame is' : R().pots.length === 2 ? 'both flames are' : 'all three flames are';
  say(`${R().doneTitle || 'Ready to serve'}. Check that ${flames} off. Tell me anything you'd change, and I'll save it with the recipe.`);
  log('done');
  persistNow();
}

// ---------------------------------------------------------------- beats (a step that can't be paused, called out one beat at a time)
function startBeat(i, { quiet = false } = {}) {
  const st = step();
  if (!st.beats) return;
  S.beat = i;
  const b = st.beats[i];
  S.beatRemaining = b.seconds ? b.seconds * 1000 : null;
  S.beatPaused = false;
  if (quiet) return;
  chime(laneChime(st.pot), 0);
  say(b.say, b.sayHi);
}

function tickBeat(dt) {
  const st = step();
  if (!st || !st.beats || S.beatRemaining == null || S.beatPaused || S.alert) return;
  S.beatRemaining -= dt;
  if (S.beatRemaining <= 0) {
    S.beatRemaining = null;
    if (S.beat < st.beats.length - 1) startBeat(S.beat + 1);
  }
}

// ---------------------------------------------------------------- YouTube mode
// The video plays through one step's segment, then pauses itself and waits for "aage".
// While it plays, only "ruko" (and ending the cook) is listened for, because the video's own voice could say "aage"
// or "ho gaya"; gestures and elbow holds still work. A cooker whistle in the video must not be counted either.
let videoCtl = null;
const videoHost = document.getElementById('videoHost');
const videoId = () => (R().source && R().source.kind === 'youtube' && R().source.videoId) || null;
const videoOn = () => !!(videoId() && S.flags.video && S.screen === 'cook');
const videoPlaying = () => !!(videoOn() && videoCtl && videoCtl.playing());

function ensureVideo() {
  if (!videoOn()) { closeVideo(); return; }
  if (videoCtl && videoCtl.videoId === videoId()) return;
  closeVideo();
  S.video.error = null;
  videoCtl = createVideo(videoHost, videoId(), {
    onReady: () => { log('video: ready'); videoToStep(S.video.autoplay !== false, S.video.resumeAt); S.video.resumeAt = null; render(); },
    onState: (st) => { log(`video: state ${st}`); if (st === 1) S.video.waiting = false; render(); },
    onError: (msg) => { S.video.error = msg; log(`video: ${msg}`); render(); },
  });
  videoCtl.videoId = videoId();
}

function closeVideo() {
  if (videoCtl) { videoCtl.destroy(); videoCtl = null; }
  if (videoHost && videoHost.firstChild) videoHost.innerHTML = '';
}

function segmentOf(i) {
  const st = STEPS()[i];
  if (!st || !st.video) return null;
  const nx = STEPS()[i + 1];
  const end = st.video.end || (nx && nx.video ? nx.video.start : null);
  return { start: st.video.start, end };
}

function videoToStep(play, at = null) {
  if (!videoOn() || !videoCtl) return;
  S.video.waiting = false;
  const seg = segmentOf(S.step);
  if (at != null) { videoCtl.seek(at, play); return; }
  if (seg) videoCtl.seek(seg.start, play);
  else if (play) videoCtl.play();
}

function tickVideo() {
  if (!videoOn() || !videoCtl || !videoCtl.ready) return;
  S.video.time = videoCtl.time();
  const seg = segmentOf(S.step);
  if (!seg || seg.end == null || !videoCtl.playing()) return;
  if (S.video.time >= seg.end - 0.25) {
    videoCtl.pause();
    S.video.waiting = true;
    S.notice = { created: Date.now(), pot: 'soft', text: 'The video waits for you', sub: 'Say “aage” for the next step, or “phir se” to watch this one again.', until: Date.now() + 10000 };
    chime('soft', 0);
    log('video: paused at the end of the step');
  }
}

// ---------------------------------------------------------------- sheets
function openSheet(kind, extra = {}) { S.sheet = { created: Date.now(), kind, ...extra }; }
// Entry animations only play on the first render of an element; renders repeat every 200 ms.
const fresh = (t) => (t && Date.now() - t < 260 ? ' enter' : '');
function closeSheet() { S.sheet = null; S.pendingScale = null; }

function showRecap() {
  const since = S.awaySince || (Date.now() - 3 * 60000);
  const mins = Math.max(1, Math.round((Date.now() - since) / 60000));
  const evs = S.events.filter((e) => e.t >= since).slice(-4);
  openSheet('recap', { mins, events: evs });
  S.awaySince = null;
  const n = evs.length;
  // Not "welcome back": "back" is a command, and the app must never say one.
  say(`You were on step ${S.step + 1}. ${n ? `${n === 1 ? 'One thing' : `${n} things`} happened while you were away. ${n === 1 ? "It's" : "They're"} on the screen.` : 'Nothing changed while you were away.'}`);
}

// ---------------------------------------------------------------- commands
function checklistItemNamed(st, heard) {
  const t = heard.toLowerCase();
  return st.checklist.findIndex((item) => (item.match(/\{(\w+)\}/g) || [])
    .map((m) => R().ingredients[m.slice(1, -1)])
    .some((ing) => ing && ing.aliases.some((al) => al && t.includes(al))));
}

function tickItem(i, via, { toggle = false } = {}) {
  const st = step();
  const key = `${S.step}:${i}`;
  pushHistory();
  S.checked[key] = toggle ? !S.checked[key] : true;
  const remaining = st.checklist.filter((_, k) => !S.checked[`${S.step}:${k}`]).length;
  const name = Tplain(st.checklist[i]).split(',')[0].replace(/^[\d¼½¾]+\s*/, '').toLowerCase();
  echo(via, !S.checked[key] ? `${name} unticked` : remaining ? `${name} ticked off, ${remaining} to go` : 'all ticked off, say “aage” when ready');
  persistNow();
}

// "Done" means different things at different moments; this picks the one that fits now.
function doAck(via) {
  if (ackAlert(via)) return;
  if (S.sheet) { if (S.pendingScale) applyScale(via); else closeSheet(); return; }
  const due = Object.values(S.timers).find((t) => t.state === 'due' && t.type === 'checkin');
  if (due) { due.state = 'done'; due.doneText = 'Checked'; echo(via, `${due.label.toLowerCase()} checked`, { undoable: false }); persistNow(); return; }
  const st = step();
  if (st.checklist) {
    // "onions done" ticks the onions; a bare "ho gaya" ticks the next one down the list.
    const named = via.heard ? checklistItemNamed(st, via.heard) : -1;
    const i = named >= 0 ? named : st.checklist.findIndex((_, k) => !S.checked[`${S.step}:${k}`]);
    if (i >= 0) { tickItem(i, via); return; }
  }
  // A beat with no countdown waits for you ("heat the ghee"), so "ho gaya" moves it on.
  if (st.beats && S.beatRemaining == null) next(via);
}

function handleIntent(cmd, via) {
  log(`intent ${cmd.intent}${cmd.heard ? ` ← “${cmd.heard}”` : ''}`);
  if (S.screen === 'done') {
    if (cmd.intent === 'stop') { store.clearSession(); S.screen = 'start'; }
    return;
  }
  if (S.screen !== 'cook') return;

  if (S.pendingConfirm && Date.now() > S.pendingConfirm.until) S.pendingConfirm = null;
  if (cmd.intent === 'yes' && S.pendingScale) { applyScale(via); return; }
  if (cmd.intent === 'no' && S.pendingScale) { closeSheet(); echo(via, `kept ${S.servings} servings`, { undoable: false }); return; }
  if (cmd.intent === 'yes' && S.pendingConfirm) { const p = S.pendingConfirm; S.pendingConfirm = null; S.notice = null; p.action(); return; }
  if (cmd.intent === 'no' && S.pendingConfirm) { S.pendingConfirm = null; S.notice = null; echo(via, 'okay, staying here', { undoable: false }); return; }

  switch (cmd.intent) {
    case 'next':
      if (S.alert) { say(`First: ${S.alert.title.toLowerCase()}.`); return; }
      next(via); break;
    case 'back': back(via); break;
    case 'repeat':
      if (videoOn() && videoCtl) { videoToStep(true); echo(via, 'playing this step again', { undoable: false }); break; }
      if (step().beats) { const b = step().beats[S.beat]; say(b.say, b.sayHi); } else speakStep();
      echo(via, 'reading it again', { undoable: false });
      break;
    case 'undo': undo(via); break;
    case 'ack': doAck(via); break;
    case 'pause':
      stopSpeaking();
      if (videoOn() && videoCtl) { videoCtl.pause(); echo(via, 'video paused, timers keep running', { undoable: false }); break; }
      if (step().beats) { S.beatPaused = true; echo(via, 'beat on hold, the pan keeps cooking', { undoable: false }); }
      else echo(via, 'quiet now, timers keep running', { undoable: false });
      break;
    case 'resume':
      if (videoOn() && videoCtl) { S.video.waiting = false; videoCtl.play(); echo(via, 'video playing', { undoable: false }); break; }
      S.beatPaused = false; echo(via, 'carrying on', { undoable: false }); break;
    case 'whistle': {
      const tm = whistleTimer();
      if (addWhistle('voice')) echo(via, `counted a whistle, ${tm.count} of ${tm.target}`);
      else echo(via, 'no cooker is counting whistles right now', { undoable: false });
      break;
    }
    case 'where': showRecap(); break;
    case 'help': openSheet('help', { until: Date.now() + 12000 }); break;
    case 'stop':
      askToConfirm('End Cook-Along now?', 'Say “haan” to finish, or “nahi” to keep cooking.', finish, 'soft');
      say('End Cook-Along now?');
      break;
    case 'howmuch': answerHowMuch(cmd.heard, via); break;
    case 'timer': addTimer(cmd.minutes, via); break;
    case 'servings': proposeScale(cmd.servings, via); break;
    default: break;
  }
  persistNow();
}

function groupOf(ing) { return R().groups.find((g) => g.key === ing.group) || null; }
function whereFor(ing) {
  const g = groupOf(ing);
  if (g && g.sub) return g.sub;
  if (potOf(R(), ing.group)) return vesselName(ing.group);
  return g ? g.title.toLowerCase() : 'recipe';
}

// Looks in this step first, then the steps ahead, then the ones behind: "ghee kitna?" means the ghee you need next.
function answerHowMuch(heard, via) {
  const t = heard.toLowerCase();
  const all = STEPS().map((_, i) => i);
  const order = [S.step, ...all.filter((i) => i > S.step), ...all.filter((i) => i < S.step).reverse()];
  let id = null;
  for (const i of order) {
    id = idsInStep(R(), STEPS()[i]).find((sid) => R().ingredients[sid].aliases.some((a) => a && t.includes(a)));
    if (id) break;
  }
  if (!id) id = findIngredientByWord(R(), heard);
  if (!id) { echo(via, 'which ingredient?', { undoable: false }); return; }
  const ing = R().ingredients[id];
  const q = fmtQty(R(), id, S.servings);
  const g = groupOf(ing);
  S.notice = { created: Date.now(), pot: (g && g.lane) || 'soft', text: `${ing.name} for the ${whereFor(ing)}: ${q}`, sub: `for ${S.servings} servings`, until: Date.now() + 8000 };
  say(spokenUnits(`${ing.name}, ${q}`));
}

// Timers live in the pot slots, so a spoken timer goes on the pot this step is about.
function addTimer(minutes, via) {
  if (!minutes || minutes > 120) return;
  const slot = step().pot && potOf(R(), step().pot) ? step().pot : R().pots[R().pots.length - 1].id;
  pushHistory();
  S.timers[slot] = makeTimer({ slot, type: 'checkin', label: 'Timer', sub: `${vesselName(slot)} · your ${minutes} min`, minutes });
  echo(via, `${minutes} minute timer on the ${vesselName(slot)}`);
}

function proposeScale(n, via) {
  if (!n || n === S.servings || n > 12) return;
  S.pendingScale = { to: n };
  openSheet('scale', { to: n });
  echo(via, `cooking for ${n}?`, { undoable: false });
  say(`Cooking for ${n}? The changes are on the screen.`);
}

function applyScale(via) {
  const to = S.pendingScale.to;
  pushHistory();
  S.servings = to;
  closeSheet();
  echo(via, `now cooking for ${to}, from this step on`);
}

// Commands that may interrupt the app while it is talking. Everything else waits, so it can't hear itself.
const BARGE_IN = ['pause', 'stop', 'ack', 'undo'];
function onTranscript(alts) {
  const text = (alts[0] || '').trim();
  if (!text) return;
  log(`heard “${text}”`);
  // A result can arrive a second after the audio ends, so the app's own last words stay suspect briefly.
  const ownVoice = spokeWithin(1200);
  if (S.screen === 'done') {
    if (ownVoice) return;
    const cmd = parseCommand(text);
    if (cmd && cmd.intent === 'stop') { store.clearSession(); S.screen = 'start'; render(); return; }
    if (!cmd) { saveNote(text); render(); }
    return;
  }
  for (const a of alts) {
    const cmd = parseCommand(a);
    if (!cmd) continue;
    if (ownVoice && !BARGE_IN.includes(cmd.intent)) { log(`ignored while speaking: “${a}”`); return; }
    if (videoPlaying() && !['pause', 'stop'].includes(cmd.intent)) { log(`ignored while the video plays: “${a}”`); return; }
    if (isLoud() && !['pause', 'stop'].includes(cmd.intent)) { log('ignored: too loud'); return; }
    handleIntent(cmd, { kind: 'voice', word: cmd.word, heard: cmd.heard });
    render();
    return;
  }
}

function saveNote(text) {
  S.notes = store.addNote(R().id, text);
  say('Saved with the recipe.');
}

// ---------------------------------------------------------------- saving the session
// Saved at most once a second while cooking, and straight away after anything that changes the plan,
// so a reload, a crash or a dead battery comes back on the same step with the timers still right.
let lastSave = 0;
function sessionData() {
  return {
    recipeId: R().id, screen: S.screen, servings: S.servings, step: S.step, beat: S.beat, beatRemaining: S.beatRemaining,
    entered: S.entered, checked: S.checked, timers: S.timers, events: S.events.slice(-30), warned: S.warned,
    history: S.history.slice(-10), clock: S.clock,
    alert: S.alert ? { ...S.alert, nextChimeAt: 0 } : null,
    video: { time: videoCtl && videoCtl.ready ? videoCtl.time() : S.video.time },
  };
}
function persist() {
  if (Date.now() - lastSave < 1000) return;
  persistNow();
}
function persistNow() {
  if (S.demo || (S.screen !== 'cook' && S.screen !== 'done')) return;
  lastSave = Date.now();
  store.saveSession(sessionData());
}

function resumeSession(sess) {
  const recipe = store.getRecipe(sess.recipeId);
  if (!recipe || !recipe.steps[sess.step]) { store.clearSession(); return false; }
  S.recipe = recipe;
  const away = Math.max(0, Date.now() - sess.savedAt);
  Object.assign(S, {
    screen: sess.screen === 'done' ? 'done' : 'cook', servings: sess.servings, step: sess.step, beat: sess.beat || 0,
    entered: sess.entered || {}, checked: sess.checked || {}, timers: sess.timers || {}, events: sess.events || [], warned: sess.warned || {},
    history: sess.history || [], speed: 1,
    // The cooking clock kept running while the app was closed: timers come back with the right time left.
    clock: (sess.clock || 0) + away,
    alert: sess.alert ? { ...sess.alert, nextChimeAt: now() + 3000 } : null,
    sheet: null, notice: null, echo: null, pendingConfirm: null, pendingScale: null, awaySince: null,
  });
  S.notes = store.getNotes(recipe.id);
  // A beat can't be trusted to have kept time, so it waits for the cook.
  if (step().beats) { S.beatRemaining = null; S.beatPaused = true; }
  S.video.resumeAt = sess.video && sess.video.time ? sess.video.time : null;
  S.video.autoplay = false;
  const mins = Math.round(away / 60000);
  S.notice = { created: Date.now(), pot: 'soft', text: `Picked up where you left off: step ${S.step + 1}`, sub: mins >= 1 ? `The app was closed for ${mins} min. Timers kept running.` : 'Timers kept running.', until: Date.now() + 10000 };
  S.needsTouch = true;
  addEvent('soft', 'App reopened');
  log(`resumed session, away ${Math.round(away / 1000)} s`);
  if (S.screen === 'cook') { startSensors(); ensureVideo(); }
  return true;
}

// ---------------------------------------------------------------- sensing hookup
let recognizer = null;
function startVoice() {
  if (!S.flags.voice) { S.voiceState = 'off'; return; }
  if (recognizer) recognizer.stop();
  recognizer = createRecognizer({
    lang: S.flags.lang,
    onAlternatives: onTranscript,
    onState: (st, err) => { S.voiceState = st; if (err) log(`voice: ${st} ${err}`); },
  });
  if (!recognizer) { S.voiceState = 'unsupported'; log('voice: not supported in this browser'); return; }
  recognizer.start();
}

const gestures = new GestureInterpreter({
  onProgress: (p) => { S.armProgress = p; },
  onEngage: () => { S.engaged = true; S.engagedAt = Date.now(); S.armProgress = null; log('gesture: palm held, engaged'); },
  onCancel: (why) => { S.engaged = false; log(`gesture: cancelled (${why})`); },
  onSwipe: (dir) => {
    S.engaged = false;
    log(`gesture: swipe ${dir}`);
    if (S.alert) return;
    if (dir === 'left') next({ kind: 'gesture', label: 'Swiped left' });
    else back({ kind: 'gesture', label: 'Swiped right' });
  },
  onThumb: () => {
    log('gesture: thumbs up');
    if (S.screen !== 'cook') return;
    const via = { kind: 'gesture', label: 'Thumbs up' };
    if (S.pendingConfirm && Date.now() < S.pendingConfirm.until) { const p = S.pendingConfirm; S.pendingConfirm = null; S.notice = null; p.action(); return; }
    doAck(via);
  },
});

const nearDetector = new NearDetector((near) => { S.nearAuto = near; log(`camera: ${near ? 'near' : 'far'}`); }, {
  thresholds: () => ({ enter: CFG.nearEnter, exit: Math.max(0.05, CFG.nearEnter - 0.08) }),
});
nearDetector.onPresence = (present) => {
  if (S.screen !== 'cook') return;
  if (!present && !S.awaySince) { S.awaySince = Date.now() - 8000; log('camera: nobody in view'); }
  else if (present && S.awaySince) {
    const awayMs = Date.now() - S.awaySince;
    if (awayMs > 60000) showRecap(); else S.awaySince = null;
  }
};

async function startCameraAndGestures() {
  if (!S.flags.camera) { S.camState = 'off'; return; }
  try {
    S.camState = 'starting';
    await startCamera(camEl);
    S.camState = 'loading';
    const models = await loadVision();
    S.camState = 'on';
    log('camera: gestures ready');
    runVisionLoop(camEl, models, {
      onHand: (hand, t) => gestures.feed(hand, t),
      onFace: (ratio, t) => { S.faceRatio = ratio; nearDetector.feed(ratio, t); },
    });
  } catch (e) {
    S.camState = 'unavailable';
    log(`camera: ${e && e.message ? e.message : e}`);
  }
}

async function startMicSensing() {
  if (!S.flags.mic) { S.micState = 'off'; return; }
  try {
    await startMic({
      getConfig: () => CFG,
      onLevel: (db, floor, ratio) => { S.level = { db, floor, ratio }; },
      onLoudChange: (loud) => { S.loudAuto = loud; log(`mic: ${loud ? 'too loud' : 'quiet again'}`); },
      onWhistle: () => {
        if (videoPlaying()) { log('whistle ignored: the video is playing'); return; }
        addWhistle('mic');
      },
    });
    S.micState = 'on';
  } catch (e) {
    S.micState = 'unavailable';
    log(`mic: ${e && e.message ? e.message : e}`);
  }
}

function startSensors() {
  // The tour simulates every input, so it never asks for the microphone or camera.
  if (S.demo) return;
  keepScreenOn();
  startVoice();
  // Camera and mic stay on between sessions, so a second cook doesn't open them twice.
  if (!['starting', 'loading', 'on'].includes(S.camState)) startCameraAndGestures();
  if (S.micState !== 'on') startMicSensing();
}

function startCooking() {
  Object.assign(S, {
    screen: 'cook', events: [], history: [], entered: {}, checked: {}, timers: {}, warned: {}, clock: 0, step: -1,
    alert: null, sheet: null, notice: null, echo: null, pendingConfirm: null, pendingScale: null, awaySince: null, needsTouch: false,
  });
  S.video = { waiting: false, error: null, time: 0, autoplay: true, resumeAt: null };
  goToStep(0, { quiet: true });
  S.history = [];
  chime('soft', 0);
  startSensors();
  ensureVideo();
  persistNow();
}

// ---------------------------------------------------------------- hold targets (elbow, knuckle)
const HOLD_MS = 500;
stage.addEventListener('pointerdown', (e) => {
  unlockAudio();
  // After a reload the browser keeps sound off until the page is touched; any touch (an elbow too) turns it back on.
  if (S.needsTouch) { S.needsTouch = false; if (S.screen === 'cook') { say(`Step ${S.step + 1}. ${spokenStep(step())}`); } render(); return; }
  const el = e.target.closest('[data-hold]');
  if (!el) {
    if (S.screen === 'cook' && !e.target.closest('[data-tap]') && !e.target.closest('#videoHost')) {
      S.notice = { created: Date.now(), pot: 'soft', text: 'Quick taps are ignored', sub: 'Hold for half a second, or use your voice.', until: Date.now() + 2500 };
    }
    return;
  }
  e.preventDefault();
  try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  const action = el.dataset.hold;
  const t0 = now();
  const ring = el.querySelector('[data-ring]');
  const bar = el.querySelector('[data-fill]');
  const holding = { action, t0, el, ring, bar, done: false };
  S.holding = holding;
  const animate = () => {
    if (S.holding !== holding) return;
    const p = Math.min(1, (now() - t0) / HOLD_MS);
    if (ring) ring.setAttribute('stroke-dashoffset', String(264 * (1 - p)));
    if (bar) bar.style.width = `${p * 100}%`;
    if (p >= 1) { holding.done = true; S.holding = null; resetHold(holding); runHold(action); render(); return; }
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
});
// Progress is drawn straight onto the element, so it has to be wound back by hand.
function resetHold(h) {
  if (h.ring) h.ring.setAttribute('stroke-dashoffset', '264');
  if (h.bar) h.bar.style.width = '0%';
}
const endHold = () => {
  const h = S.holding;
  if (!h) return;
  if (!h.done) S.notice = { created: Date.now(), pot: 'soft', text: 'Hold a little longer', sub: 'Half a second, so splashes and bumps never count.', until: Date.now() + 2500 };
  S.holding = null;
  resetHold(h);
  render();
};
stage.addEventListener('pointerup', endHold);
stage.addEventListener('pointercancel', endHold);

function runHold(action) {
  const via = { kind: 'hold' };
  if (action === 'next') next(via);
  else if (action === 'back') back(via);
  else if (action === 'ack') doAck(via);
  else if (action === 'close') closeSheet();
  else if (action === 'video') { if (videoCtl) { if (videoCtl.playing()) videoCtl.pause(); else { S.video.waiting = false; videoCtl.play(); } } }
  else if (action.startsWith('tick:')) tickItem(Number(action.slice(5)), via, { toggle: true });
  persistNow();
}

// ---------------------------------------------------------------- taps on the clean-hands screens
function openRecipe(recipe) {
  S.recipe = recipe;
  S.servings = Math.max(1, Math.min(12, recipe.baseServings * (recipe.id === DAL_TADKA.id ? 2 : 1)));
  S.notes = store.getNotes(recipe.id);
  S.screen = 'start';
  render();
}

stage.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tap]');
  if (!el) return;
  const a = el.dataset.tap;
  if (a === 'tour') { tour.start(); return; }
  if (lib.onTap(a, el, e)) return;
  if (a === 'minus') S.servings = Math.max(1, S.servings - 1);
  if (a === 'plus') S.servings = Math.min(12, S.servings + 1);
  if (a === 'start') startCooking();
  if (a === 'restart') { S.screen = 'start'; }
  if (a === 'library') { S.screen = 'library'; }
  render();
});
stage.addEventListener('change', (e) => {
  if (lib.onChange(e)) return;
  const el = e.target.closest('[data-flag]');
  if (!el) return;
  S.flags[el.dataset.flag] = el.checked;
  saveSettings();
});
stage.addEventListener('input', (e) => { lib.onInput(e); });

function saveSettings() { store.saveSettings({ flags: S.flags, cfg: CFG }); }

// ---------------------------------------------------------------- rendering
function seg(i) {
  if (i < S.step) return '<div class="seg done"></div>';
  if (i === S.step) return `<div class="seg now${step().pot ? '' : ' neutral'}"></div>`;
  return '<div class="seg"></div>';
}

function pills() {
  const loud = isLoud();
  let voice;
  if (S.voiceState === 'demo') voice = `<div class="pill demo">${I.mic(20)}<div>Voice: simulated</div></div>`;
  else if (!S.flags.voice || S.voiceState === 'off') voice = `<div class="pill off">${I.micOff(20, '#4B5056')}<div>Voice off</div></div>`;
  else if (S.voiceState === 'unsupported' || S.voiceState === 'blocked') voice = `<div class="pill off">${I.micOff(20, '#4B5056')}<div>No voice here</div></div>`;
  else if (loud) voice = `<div class="pill off">${I.micOff(20, '#4B5056')}<div>Too loud</div></div>`;
  else if (isSpeaking()) voice = `<div class="pill dark">${I.speaker(20, '#fff')}<div>Reading aloud</div></div>`;
  else if (videoPlaying()) voice = `<div class="pill">${I.mic(20)}<div>Only “ruko”</div></div>`;
  else voice = `<div class="pill">${I.mic(20)}<div>Listening</div><div class="meter"><i style="height:6px"></i><i style="height:13px"></i><i style="height:9px"></i></div></div>`;

  let cam;
  const arm = S.armProgress != null
    ? `<svg class="arm" viewBox="0 0 100 40" preserveAspectRatio="none"><rect x="1.5" y="1.5" width="97" height="37" rx="18.5" fill="none" stroke="#F26829" stroke-width="3" pathLength="100" stroke-dasharray="${(S.armProgress * 100).toFixed(1)} 100"/></svg>`
    : '';
  if (S.camState === 'demo' && S.engaged) cam = `<div class="pill dark">${I.palm(20, '#fff')}<div>Palm (simulated)</div></div>`;
  else if (S.camState === 'demo') cam = `<div class="pill demo">${I.palm(20)}<div>Gestures: simulated</div></div>`;
  else if (!S.flags.camera || S.camState === 'off') cam = `<div class="pill off">${I.camera(20, '#4B5056')}<div>Camera off</div></div>`;
  else if (S.camState === 'starting' || S.camState === 'loading') cam = `<div class="pill">${I.palm(20)}<div>Gestures loading</div></div>`;
  else if (S.camState === 'unavailable') cam = `<div class="pill off">${I.palm(20, '#4B5056')}<div>No gestures</div></div>`;
  else if (S.engaged) cam = `<div class="pill dark">${I.palm(20, '#fff')}<div>Palm seen</div></div>`;
  else if (isNear()) cam = `<div class="pill dark">${I.camera(20, '#fff')}<div>You're close</div></div>`;
  else cam = `<div class="pill">${I.palm(20)}<div>Gestures</div>${arm}</div>`;
  return `<div class="pills">${voice}${cam}</div>`;
}

function topbar() {
  return `<div class="topbar">
    <div class="title"><div class="a">${esc(R().title)}</div><div class="b">${S.servings} servings</div></div>
    <div class="progress"><div class="lbl">Step ${S.step + 1} of ${STEPS().length}</div><div class="segs${STEPS().length > 16 ? ' tight' : ''}">${STEPS().map((_, i) => seg(i)).join('')}</div></div>
    ${pills()}
  </div>`;
}

function placeChip(st) {
  const pot = st.pot;
  const L = lane(pot);
  if (!L) {
    const icon = st.icon === 'plate' ? I.plate(20, '#fff') : st.icon === 'flame' ? I.flame(20, '#fff') : I.knife(20, '#fff');
    return `<div class="place" style="background:#EEF0F2"><div class="dot" style="width:32px;height:32px;background:var(--ink)">${icon}</div><div>${esc(st.place)}</div></div>`;
  }
  const icon = st.icon === 'flame' ? I.flame(20, L.ink) : potIcon(pot, 22, L.ink);
  return `<div class="place" style="background:${L.tint}"><div class="dot" style="width:32px;height:32px;background:${L.color}">${icon}</div><div>${esc(st.place)}</div></div>`;
}

function cueHtml(st) {
  if (!st.cue) return '';
  if (st.cue.kind === 'doneness') {
    return `<div class="cue"><div class="k">Done when they look like this</div><div class="scale">${st.cue.stops.map(([c, l], i) => `<div><div class="sw${i === st.cue.target ? ' target' : ''}" style="background:${c}"></div><div class="l${i === st.cue.target ? ' target' : ''}">${esc(l)}</div></div>`).join('')}</div></div>`;
  }
  return `<div class="cue"><div class="k">Done when</div><div class="txt">${esc(st.cue.text)}</div></div>`;
}

// "Ghee" appears in three pots, so shared names get the group in front: "Tadka ghee".
function ingredientLabel(id) {
  const ing = R().ingredients[id];
  const shared = Object.values(R().ingredients).filter((x) => x.name === ing.name).length > 1;
  const g = groupOf(ing);
  return shared && g ? `${g.title} ${ing.name.toLowerCase()}` : ing.name;
}

function stepBody(st) {
  let body = '';
  if (st.checklist) {
    body = `<div class="list">${st.checklist.map((c, i) => {
      const done = S.checked[`${S.step}:${i}`];
      return `<div class="check${done ? ' done' : ''}" data-hold="tick:${i}"><div class="box">${done ? I.check(26, '#fff') : ''}</div><div class="t">${T(c)}</div><div class="holdfill" data-fill></div></div>`;
    }).join('')}</div>`;
  } else if (st.lineup) {
    body = `<div class="list">${st.lineup.map(([n, q], i) => `<div class="li"><div class="n">${i + 1}</div><div class="t">${T(n)}</div><div class="q">${T(q)}</div></div>`).join('')}</div>`;
  }
  const long = T(st.headline).length > 40 ? ' long' : '';
  return `<div class="stepcard${body ? ' listy' : ''}">
    <div class="top">
      <div class="tagrow">${placeChip(st)}<div class="stepno">Step ${S.step + 1}${st.lineup ? ' · get ready' : ''}</div>${st.fast ? `<div class="fastchip">${I.flame(18, '#AA3606')}<div>Can't pause</div></div>` : ''}</div>
      <h1 class="headline${long}">${T(st.headline, 'html')}</h1>
      ${st.detail ? `<p class="detail">${T(st.detail)}</p>` : ''}
      ${body}
    </div>
    ${cueHtml(st)}
  </div>`;
}

// YouTube layout: the video takes the top of the step area; the step headline sits under it at stove size.
function videoStepBody(st) {
  const seg = segmentOf(S.step);
  let status;
  if (S.video.error) status = `${I.warn(20, '#AA3606')}<div>${esc(S.video.error)}</div>`;
  else if (!videoCtl || !videoCtl.ready) status = `${I.video(20)}<div>Loading the video…</div>`;
  else if (S.video.waiting) status = `${I.pause(20)}<div>Waiting for you. Say <b>“aage”</b> for the next step</div>`;
  else if (videoCtl.playing()) status = `${I.play(20)}<div>${seg && seg.end != null ? `Plays to ${fmtTime(seg.end)}, then waits for you` : 'Playing'} · <b>“ruko”</b> pauses</div>`;
  else status = `${I.pause(20)}<div>Paused · say <b>“chalo”</b> to play</div>`;
  return `<div class="vstep">
    <div class="vframe" data-hold="video"></div>
    <div class="vcard">
      <div class="tagrow">${placeChip(st)}<div class="stepno">Step ${S.step + 1}</div>${st.fast ? `<div class="fastchip">${I.flame(18, '#AA3606')}<div>Can't pause</div></div>` : ''}<div class="vtime">${seg ? fmtTime(S.video.time) : ''}</div></div>
      <h1 class="vheadline">${T(st.headline, 'html')}</h1>
      <div class="vstatus">${status}</div>
    </div>
  </div>`;
}

function gestureHud() {
  const st = step();
  let nextLabel;
  let backLabel;
  if (st.beats) {
    nextLabel = S.beat < st.beats.length - 1 ? `Next: ${st.beats[S.beat + 1].label.toLowerCase()}` : `Next: ${STEPS()[S.step + 1] ? Tplain(STEPS()[S.step + 1].headline).toLowerCase() : 'finish'}`;
    backLabel = S.beat > 0 ? `Back: ${st.beats[S.beat - 1].label.toLowerCase()}` : `Back: step ${S.step}`;
  } else {
    nextLabel = S.step < STEPS().length - 1 ? `Next: ${Tplain(STEPS()[S.step + 1].headline).toLowerCase()}` : 'Next: finish';
    backLabel = S.step > 0 ? `Back: step ${S.step}` : 'Back: nothing before this';
  }
  return `<div class="gesture-hud">
    <div class="palm">${I.palm(64, '#171B20', 1.8)}</div>
    <div><div class="k">Palm seen</div><div class="big">Now swipe</div></div>
    <div class="dirs">
      <div class="dir">${I.left(44)}<div style="min-width:0"><div class="a">Swipe left</div><div class="b">${esc(nextLabel)}</div></div></div>
      <div class="dir r"><div style="text-align:right;min-width:0"><div class="a">Swipe right</div><div class="b">${esc(backLabel)}</div></div>${I.right(44)}</div>
    </div>
    <div class="foot">Drop your hand to cancel. Swipes count for 3 seconds.</div>
  </div>`;
}

function timerValue(t) {
  if (t.type === 'whistle') return `${t.count} of ${t.target}`;
  if (t.state === 'done') return t.doneText || 'Done';
  if (t.state === 'due') return 'Check';
  if (t.type === 'cooling') return `~${Math.max(1, Math.ceil(left(t) / 60000))} min`;
  return fmtClock(left(t), t.type !== 'checkin');
}

function timerCard(slot) {
  const t = S.timers[slot];
  const L = lane(slot);
  if (!t) return `<div class="timer empty">${esc(potName(slot))}: not started</div>`;
  const loud = t.state === 'soon' || t.state === 'due';
  const white = L.ink === '#FFFFFF';
  const bg = loud ? L.color : L.tint;
  const fg = loud && white ? '#fff' : 'var(--ink)';
  const iconBg = loud ? '#fff' : L.color;
  const iconColor = loud ? (white ? L.color : '#171B20') : L.ink;
  const head = `<div class="h"><div class="ic" style="background:${iconBg}">${potIcon(slot, 28, iconColor)}</div><div style="min-width:0"><div class="nm">${esc(t.label)}</div><div class="sb" style="color:${loud ? fg : ''}">${esc(t.sub)}</div></div></div>`;
  let mid = '';
  let foot = '';
  if (t.type === 'whistle') {
    const dots = Array.from({ length: t.target }, (_, i) => `<div class="d${i < t.count ? ' on' : ''}" style="border-color:${fg};${i < t.count ? `background:${fg}` : ''}"></div>`).join('');
    mid = `<div class="whistles${t.target > 3 ? ' many' : ''}"><div class="dots">${dots}</div><div class="c">${t.count} of ${t.target}</div></div>`;
    let hint = 'Listening for the cooker';
    if (videoPlaying()) hint = 'Paused while the video plays';
    else if (t.times.length >= 2) {
      const gap = t.times[t.times.length - 1] - t.times[t.times.length - 2];
      const until = gap - (Date.now() - t.times[t.times.length - 1]);
      hint = until > 30000 ? `Next whistle in about ${Math.max(1, Math.round(until / 60000))} min` : 'Next whistle any moment';
    }
    foot = `<div class="sb" style="font-size:17px;color:${loud ? fg : 'var(--ink2)'}">${t.state === 'due' ? 'Needs you now' : hint}</div>`;
  } else if (t.state === 'done') {
    mid = `<div class="big" style="font-size:38px">${esc(t.doneText || 'Done')}</div>`;
    foot = `<div class="bar" style="background:${L.tint}"><i style="width:100%;background:${L.deep}"></i></div>`;
  } else {
    const rem = left(t);
    const frac = 1 - rem / t.totalMs;
    if (t.type === 'cooling') {
      // Minutes, not seconds: the pressure drops at its own pace, so a seconds countdown would be false precision.
      mid = `<div class="big" style="font-size:64px">~${Math.max(1, Math.ceil(rem / 60000))} min</div>`;
      foot = `<div class="sb" style="font-size:17px;color:${loud ? fg : 'var(--ink2)'}">until it is safe to open</div>`;
      return `<div class="timer" style="background:${bg};color:${fg}">${head}${mid}${foot}</div>`;
    }
    const big = fmtClock(rem, t.type !== 'checkin');
    const unit = t.state === 'due' ? 'now' : t.type === 'checkin' ? 'to check' : 'left';
    mid = `<div class="row"><div class="big">${t.state === 'due' ? 'Check' : big}</div><div class="unit" style="color:${loud ? fg : ''}">${unit}</div></div>`;
    const fill2 = white ? (loud ? '#fff' : L.color) : L.deep;
    foot = `<div class="bar" style="background:${loud ? 'rgba(255,255,255,0.35)' : L.track}"><i style="width:${(frac * 100).toFixed(1)}%;background:${fill2}"></i></div>`;
  }
  return `<div class="timer" style="background:${bg};color:${fg}">${head}${mid}${foot}</div>`;
}

const railView = () => `<div class="rail">${R().pots.map((p) => timerCard(p.id)).join('')}</div>`;

function timerChip(slot) {
  const t = S.timers[slot];
  if (!t) return '';
  const L = lane(slot);
  return `<div class="tchip" style="background:${L.tint}"><div class="dot" style="background:${L.color}">${potIcon(slot, 20, L.ink)}</div><div class="n">${esc(t.label)}</div><div class="v">${esc(timerValue(t))}</div></div>`;
}

function backHold() {
  return `<button class="hold back" data-hold="back" aria-label="Back, hold to confirm">${I.left(56, '#171B20')}<div class="t">Back</div><div class="s">hold</div></button>`;
}

function nextHold() {
  const nextLabel = S.step < STEPS().length - 1 ? T(STEPS()[S.step + 1].headline) : 'Finish';
  return `<button class="hold next" data-hold="next" aria-label="Next, hold to confirm">
    <div class="ring"><svg class="r" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="42" fill="none" stroke="#3A3F46" stroke-width="8"/><circle data-ring cx="48" cy="48" r="42" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-dasharray="264 264" stroke-dashoffset="264" transform="rotate(-90 48 48)"/></svg>${I.right(48, '#fff')}</div>
    <div class="t">Next</div><div class="s">${nextLabel}<br>hold ½ s</div>
  </button>`;
}

// One line at the bottom, newest message first: what was heard beats a notice only if it came later.
function bottomBar(st) {
  if (S.needsTouch) {
    return `<div class="bottom"><div class="banner touch">${I.speaker(36, '#171B20')}<div style="min-width:0"><div class="t">Touch the screen once to turn sound back on</div><div class="s">An elbow works. The browser keeps sound off after a reload until the page is touched.</div></div></div></div>`;
  }
  const showEcho = S.echo && (!S.notice || S.echo.created >= S.notice.created);
  if (showEcho) {
    return `<div class="bottom"><div class="echo${fresh(S.echo.created)}">
      <div style="display:flex;align-items:center;gap:14px;min-width:0"><div class="ok">${I.check(28, '#171B20', 2.6)}</div><div class="t">${esc(S.echo.text)}</div></div>
      ${S.echo.undoable ? `<div class="u">${I.undo(24, '#fff')}<div>Wrong? Say <b>“galat”</b></div></div>` : ''}
    </div></div>`;
  }
  if (S.notice) {
    const L = lane(S.notice.pot);
    const dot = L ? `<div class="dot" style="width:36px;height:36px;background:${L.color}">${potIcon(S.notice.pot, 22, L.ink)}</div>` : I.bell(32, '#171B20');
    return `<div class="bottom"><div class="banner${fresh(S.notice.created)}">${dot}<div style="min-width:0"><div class="t">${esc(S.notice.text)}</div>${S.notice.sub ? `<div class="s">${esc(S.notice.sub)}</div>` : ''}</div></div></div>`;
  }
  if (isLoud()) {
    return `<div class="bottom"><div class="banner">${I.speaker(36, '#171B20')}<div><div class="t">Too loud to hear you, so voice is paused</div><div class="s">It turns back on by itself when the kitchen is quieter. Gestures and timers keep working.</div></div></div></div>`;
  }
  if (st.beats) {
    const b = st.beats[S.beat];
    return `<div class="bottom">
      <div class="saying">${I.speaker(30, '#171B20')}<div class="t">Saying: <b>“${esc(b.say)}”</b></div></div>
      <div class="hints"><div class="hint"><b>“ruko”</b> holds the beat</div></div>
    </div>`;
  }
  if (isNear()) {
    return `<div class="bottom"><div class="timerstrip">${R().pots.map((p) => timerChip(p.id)).join('')}</div>
      <div style="display:flex;align-items:center;gap:10px;font-size:20px;color:#2B3036">${I.warn(22, '#2B3036')}<div>${noCamera() && S.nearOverride == null ? 'No camera, so the hold targets stay on' : 'Splash guard: only half-second holds count'}</div></div></div>`;
  }
  const nx = STEPS()[S.step + 1];
  const nextText = nx ? T(nx.headline) : 'Serve';
  let nextKey = 'Next';
  if (nx && nx.waitFor && !potReady(nx.waitFor)) nextKey = potOf(R(), nx.waitFor) && potOf(R(), nx.waitFor).vessel === 'cooker' ? 'Next, once the cooker opens' : `Next, once the ${esc(potName(nx.waitFor).toLowerCase())} is ready`;
  const hints = videoOn()
    ? `<div class="hint">${I.mic(18)}<div><b>“ruko”</b> pause</div></div><div class="hint">${I.mic(18)}<div><b>“aage”</b> when paused</div></div><div class="hint">${I.palm(18)}<div><b>Palm</b>, then swipe</div></div>`
    : `<div class="hint">${I.mic(18)}<div><b>“aage”</b> next</div></div><div class="hint">${I.mic(18)}<div><b>“peeche”</b> back</div></div><div class="hint">${I.palm(18)}<div><b>Palm</b>, then swipe</div></div>`;
  return `<div class="bottom">
    <div class="nextup"><div class="k">${nextKey}</div><div class="t">${nextText}</div></div>
    <div class="hints">${hints}</div>
  </div>`;
}

function beatStrip(st) {
  return `<div class="beats" style="grid-template-columns:repeat(${st.beats.length}, minmax(0, 1fr))">${st.beats.map((x, i) => {
    const cls = i < S.beat ? 'done' : i === S.beat ? 'now' : '';
    const n = i < S.beat ? I.check(22, '#fff') : String(i + 1);
    return `<div class="beat ${cls}"><div class="n">${n}</div><div class="t">${esc(x.label)}</div></div>`;
  }).join('')}</div>`;
}

function beatBody(st) {
  const b = st.beats[S.beat];
  const total = (b.seconds || 0) * 1000;
  const rem = S.beatRemaining != null ? S.beatRemaining : total;
  const frac = total ? Math.max(0, rem / total) : 1;
  const C = 2 * Math.PI * 128;
  const ring = total
    ? `<div class="beatring"><svg width="300" height="300" viewBox="0 0 300 300"><circle cx="150" cy="150" r="128" fill="none" stroke="#FFE4D6" stroke-width="22"/><circle cx="150" cy="150" r="128" fill="none" stroke="#F26829" stroke-width="22" stroke-linecap="round" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 150 150)"/></svg><div><div class="v">${fmtClock(rem, false)}</div><div class="u">${S.beatPaused ? 'on hold' : 'this beat'}</div></div></div>`
    : `<div class="beatring"><svg width="300" height="300" viewBox="0 0 300 300"><circle cx="150" cy="150" r="128" fill="none" stroke="#FFE4D6" stroke-width="22"/></svg><div><div class="v" style="font-size:44px">Say</div><div class="u" style="font-size:26px;font-weight:800;color:#171B20">${b.prompt || '“aage”'}</div></div></div>`;
  const nextBeat = st.beats[S.beat + 1];
  const nextStep = STEPS()[S.step + 1];
  const thenText = b.then || (nextBeat ? `Then: ${nextBeat.headline.toLowerCase()}` : `Then: ${nextStep ? Tplain(nextStep.headline).toLowerCase() : 'serve'}`);
  return `<div class="beatbody">
      <div class="card beatnow">
        <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
          <div class="k">Beat ${S.beat + 1} of ${st.beats.length} · now</div>
          <h1>${esc(b.headline)}</h1>
          <p>${T(b.detail)}</p>
        </div>
        ${ring}
      </div>
      <div class="then">${I.flameOff(34, '#AA3606')}<div>${esc(thenText)}</div></div>
    </div>`;
}

function alertView() {
  const a = S.alert;
  if (!a) return '';
  const L = lane(a.pot) || LANES[0];
  const fg = L.ink === '#FFFFFF' ? '#fff' : '#171B20';
  const others = R().pots.map((p) => p.id).filter((s) => s !== a.pot && S.timers[s] && S.timers[s].state !== 'done').map((s) => {
    const t = S.timers[s];
    return `<div class="mini"><div style="width:14px;height:14px;border-radius:50%;background:${lane(s).color}"></div><div class="n">${esc(t.label)}</div><div class="v">${esc(timerValue(t))}</div></div>`;
  }).join('');
  const wt = S.timers[a.pot];
  const dots = wt && wt.type === 'whistle'
    ? `<div style="display:flex;align-items:center;gap:14px"><div style="display:flex;gap:10px">${Array.from({ length: Math.min(wt.target, 6) }, () => `<div style="width:40px;height:40px;border-radius:50%;background:${fg}"></div>`).join('')}</div><div class="mono" style="font-size:40px;font-weight:700">${wt.count} of ${wt.target}</div></div>`
    : '';
  const title = esc(a.title).replace(' the ', '<br>the ');
  return `<div class="alert" data-hold="ack" style="background:${L.color};color:${fg}">
    <div class="top"><div class="who"><div class="badge">${potIcon(a.pot, 48, L.ink === '#FFFFFF' ? L.color : '#171B20')}</div><div><div class="k">${esc(a.kicker)}</div><div class="s">${esc(a.sub)}</div></div></div>${dots}</div>
    <div style="display:flex;flex-direction:column;gap:22px"><h1${a.title.length > 26 ? ' class="long"' : ''}>${title}</h1><p>${esc(a.body)}</p></div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="acts">
        <div class="act">${I.mic(40, '#171B20')}<div><div class="a">Say “ho gaya”</div><div class="b">or “done”</div></div></div>
        <div class="act">${I.thumb(40, '#171B20')}<div><div class="a">Thumbs up</div><div class="b">to the camera</div></div></div>
        <div class="act">${I.hold(40, '#171B20')}<div><div class="a">Hold anywhere</div><div class="b">elbow or knuckle, ½ s</div></div></div>
      </div>
      <div class="foot"><div style="display:flex;gap:10px">${others}</div><div>Chimes again every 15 s, a little louder each time</div></div>
    </div>
    <div class="holdfill" data-fill></div>
  </div>`;
}

function fmtNumberSafe(q) { const r = Math.round(q * 4) / 4; const w = Math.floor(r); const f = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' }[r - w]; return w === 0 ? (f || '0') : `${w}${f || ''}`; }

function scaleFixes(to) {
  const out = [];
  const fixes = R().scaleFixes || [];
  for (const f of fixes) {
    if (S.step < f.fromStep) continue;
    if ((f.when === 'more' && to <= S.servings) || (f.when === 'less' && to >= S.servings)) continue;
    const body = f.body
      .replace(/\{more:(\w+)\}/g, (_, id) => fmtNumberSafe((R().ingredients[id] ? R().ingredients[id].qty : 0) * (to - S.servings) / R().baseServings))
      .replace('{servings}', String(S.servings));
    out.push([f.pot, f.title, body]);
  }
  if (!fixes.length) {
    // Imported recipes: any pot that is already cooking can't be rescaled, so say which ones.
    const started = R().pots.filter((p) => S.timers[p.id]);
    if (started.length) out.push([started[0].id, `Already cooking for ${S.servings}`, `${started.map((p) => p.name).join(' and ')}: ${to > S.servings ? 'make a second, smaller batch for the extra' : 'keep the extra for tomorrow'}.`]);
  }
  return out;
}

function sheetView() {
  const sh = S.sheet;
  if (!sh) return '';
  if (sh.kind === 'help') {
    const vocab = videoOn() ? [...VOCABULARY.slice(0, 3), ['ruko / chalo', 'pause / play the video'], ...VOCABULARY.slice(4)] : VOCABULARY;
    return `<div class="sheet" data-hold="close"><div class="topbar"><div class="title"><div class="a">What you can say</div></div><div class="hint">Hold anywhere to close</div></div>
      <div class="body" style="grid-template-columns:1fr;align-content:start;padding:8px 48px">
        <div class="cmdgrid">${vocab.map(([w, d]) => `<b>${w}</b><div>${d}</div>`).join('')}</div>
        <div style="font-size:22px;color:var(--ink2);margin-top:24px">Gestures: hold up a palm for half a second, then swipe left (next) or right (back). Thumbs up clears an alert.</div>
      </div></div>`;
  }
  if (sh.kind === 'recap') {
    const st = step();
    const evs = sh.events.length
      ? sh.events.map((e) => { const L = lane(e.pot) || { color: '#6E7277', tint: '#EEF0F2' }; return `<div class="box" style="background:${L.tint}"><div class="h"><div style="width:26px;height:26px;border-radius:50%;background:${L.color}"></div>${new Date(e.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div><div class="b">${esc(e.text)}</div></div>`; }).join('')
      : '<div class="box" style="background:#EEF0F2"><div class="b">Nothing changed while you were away.</div></div>';
    return `<div class="sheet" data-hold="close">${topbar()}
      <div class="body" style="grid-template-columns:minmax(0,1fr) 420px">
        <div style="display:flex;flex-direction:column;gap:18px;padding:8px 4px 0">
          <h1>Welcome back</h1>
          <div style="font-size:28px;color:#2B3036">You were away for about ${sh.mins} min.</div>
          <div class="card" style="padding:24px 28px;display:flex;flex-direction:column;gap:8px">
            <div class="sec">You were on</div>
            <div style="font-size:40px;font-weight:800;line-height:1.1">Step ${S.step + 1}: ${T(st.headline)}</div>
            <div style="font-size:22px;color:#2B3036">Say <b>“aage”</b> to carry on, or <b>“phir se”</b> to hear it again.</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;min-height:0"><div class="sec" style="padding-top:14px">While you were away</div>${evs}</div>
      </div><div style="height:48px"></div></div>`;
  }
  if (sh.kind === 'scale') {
    const to = sh.to;
    const ahead = new Set();
    STEPS().slice(S.step).forEach((st) => idsInStep(R(), st).forEach((id) => { if (R().ingredients[id].kind !== 'fixed') ahead.add(id); }));
    // Eight rows fit at counter-distance size; anything beyond is summarised rather than shrunk.
    const ids = [...ahead];
    const shown = ids.length > 8 ? ids.slice(0, 7) : ids;
    const rows = shown.map((id) => {
      const was = fmtQty(R(), id, S.servings).split(' ')[0];
      return `<div class="sr-n">${esc(ingredientLabel(id))}</div><div class="mono sr-q"><span style="color:#6E7277">${was} →</span> <b>${esc(fmtQty(R(), id, to))}</b></div>`;
    }).join('') + (ids.length > shown.length ? `<div class="sr-n" style="color:var(--ink2)">and ${ids.length - shown.length} more, all scaled</div><div></div>` : '');
    const f = to / S.servings;
    const fq = Math.round(f * 4) / 4;
    const factor = Math.abs(fq - f) < 0.01 ? fmtNumberSafe(fq) : f.toFixed(2);
    const cooked = scaleFixes(to);
    return `<div class="sheet">${topbar()}
      <div style="padding:4px 36px 18px;display:flex;align-items:baseline;justify-content:space-between"><h1>Cooking for ${to} now?</h1><div style="font-size:24px;color:#2B3036">Here's what can still change</div></div>
      <div class="body" style="grid-template-columns:minmax(0,1fr) 420px">
        <div class="card" style="padding:26px 30px;display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;overflow:hidden">
          <div style="display:flex;justify-content:space-between"><div class="sec">From step ${S.step + 1} on · ×${factor}</div><div style="font-size:18px;color:var(--ink2)">was → now</div></div>
          <div class="scalerows">${rows || '<div style="font-size:24px">Nothing left to scale.</div>'}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">${cooked.length ? `<div class="sec">Already cooked for ${S.servings}</div>` : ''}${cooked.map(([p, h, b]) => { const L = lane(p) || LANES[0]; return `<div class="box" style="background:${L.tint}"><div class="h"><div style="width:30px;height:30px;border-radius:50%;background:${L.color}"></div>${esc(h)}</div><div class="b" style="font-size:22px">${esc(b)}</div></div>`; }).join('')}</div>
      </div>
      <div class="bottom" style="justify-content:flex-start;gap:12px">
        <div class="hint" style="background:var(--ink);color:#fff;border:0;font-size:24px;padding:16px 22px">${I.mic(24, '#fff')}<div>Say <b>“haan”</b> to switch to ${to}</div></div>
        <div class="hint" style="font-size:24px;padding:16px 22px"><div><b>“nahi”</b> keeps it at ${S.servings}</div></div>
        <div style="font-size:20px;color:var(--ink2)">Nothing changes until you say yes</div>
      </div></div>`;
  }
  return '';
}

function startTips() {
  const r = R();
  const out = [];
  const factor = S.servings / r.baseServings;
  const factorText = factor === 1 ? 'as written' : factor === 2 ? 'doubled' : factor === 0.5 ? 'halved' : `×${Number.isInteger(factor) ? factor : factor.toFixed(1)}`;
  out.push(`<div><b>Quantities ${factorText}</b> from the recipe's ${r.baseServings}, rounded to spoons and cups</div>`);
  for (const tip of r.tips || []) {
    if (tip.kind === 'whistles') {
      const w = r.steps.flatMap((s) => s.onEnter || []).find((t) => t.type === 'whistle');
      if (w) out.push(`<div><b>Whistles stay at ${w.target}</b>: more ${esc(potName(w.slot).toLowerCase())} takes longer to whistle, not more whistles</div>`);
    } else if (tip.kind === 'cooker') {
      // Dal foams under pressure, so keep the cooker well under half full: contents x 2.5.
      const litres = tip.ids.reduce((a, id) => a + (scaledQty(r, id, S.servings) || 0) * 0.24, 0) * 2.5;
      out.push(`<div><b>Use a ${litres <= 2 ? '2 L' : litres <= 3 ? '3 L' : '5 L'} cooker or bigger</b></div>`);
    } else if (tip.kind === 'text') out.push(`<div>${esc(tip.text)}</div>`);
  }
  if (!r.tips.length && hasWhistles(r)) {
    const w = r.steps.flatMap((s) => s.onEnter || []).find((t) => t.type === 'whistle');
    out.push(`<div><b>Whistles stay at ${w.target}</b> when you cook for more: it takes longer, not more whistles</div>`);
  }
  return out.join('');
}

function startView() {
  const r = R();
  const groups = (r.groups.length ? r.groups : [{ key: 'all', title: 'Ingredients', sub: '', lane: null, ids: Object.keys(r.ingredients) }]).map((g) => {
    const L = lane(g.lane) || { color: 'var(--ink)', ink: '#fff' };
    const icon = g.icon === 'flame' ? I.flame(18, '#171B20') : g.lane ? potIcon(g.lane, 20, L.ink) : I.knife(18, '#fff');
    return `<div class="card ing-card"><div class="h"><div class="dot" style="background:${L.color}">${icon}</div><div class="n">${esc(g.title)}</div><div class="v">${esc(g.sub || '')}</div></div>
      ${g.ids.map((id) => `<div class="ing-row"><div>${esc(r.ingredients[id].name)}</div><div class="q">${esc(fmtQty(r, id, S.servings))}</div></div>`).join('')}</div>`;
  }).join('');
  const builtin = r.source.kind === 'builtin';
  const chips = (r.chips.length ? r.chips : []).map((c) => `<div class="chip">${esc(c)}</div>`).join('');
  const vid = videoId();
  const srcLine = r.source.kind === 'youtube' ? `From YouTube${r.source.author ? `: ${esc(r.source.author)}` : ''}` : r.source.kind === 'blog' ? `From ${esc(r.source.site || 'the web')}` : r.source.kind === 'text' ? 'From pasted text' : esc(r.crumb || 'Recipes');
  const videoToggle = vid ? `<label class="toggle"><input type="checkbox" data-flag="video" ${S.flags.video ? 'checked' : ''}>Play the video</label>` : '';
  return `<div class="start">
    <div class="start-left">
      <div style="display:flex;flex-direction:column;gap:18px">
        <div class="crumbrow"><button type="button" class="crumb-btn" data-tap="library">${I.left(18, '#171B20', 2.4)}<span>Recipes</span></button><div class="crumb">${srcLine}</div>${builtin ? '' : `<button type="button" class="crumb-btn" data-tap="edit">${I.edit(18)}<span>Edit</span></button>`}</div>
        <h1${r.title.length > 34 ? ' class="long"' : ''}>${esc(r.title)}</h1>
        <div class="chips">${chips}</div>
        <div class="card serves">
          <div class="serves-row"><div class="label">Cooking for</div>
            <div class="stepper"><button type="button" data-tap="minus" aria-label="Fewer servings">${svg(28, '<path d="M5 12h14"/>', '#171B20', 2.6)}</button><div class="n">${S.servings}</div><button type="button" class="dark" data-tap="plus" aria-label="More servings">${svg(28, '<path d="M5 12h14"/><path d="M12 5v14"/>', '#fff', 2.6)}</button></div>
          </div>
          <div class="divider"></div>
          <div class="serves-notes">${startTips()}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="toggles">
          <label class="toggle"><input type="checkbox" data-flag="voice" ${S.flags.voice ? 'checked' : ''}>Voice</label>
          <label class="toggle"><input type="checkbox" data-flag="camera" ${S.flags.camera ? 'checked' : ''}>Gestures</label>
          <label class="toggle"><input type="checkbox" data-flag="mic" ${S.flags.mic ? 'checked' : ''}>Whistle listening</label>
          <label class="toggle"><input type="checkbox" data-flag="readAloud" ${S.flags.readAloud ? 'checked' : ''}>Read aloud</label>
          ${videoToggle}
        </div>
        <button type="button" class="start-cta" data-tap="start"><div><div class="t">Start Cook-Along</div><div class="s">Hands-free from here</div></div>${I.right(40, '#fff')}</button>
        <div class="privacy">${I.lock(22, '#2B3036')}<div>Prop the tablet 3 to 5 ft away, facing you. Nothing is recorded. Camera and whistle sensing stay on this device; voice uses the browser's speech service.</div></div>
      </div>
    </div>
    <div class="ingredients">
      <div class="ing-head"><div class="t">Ingredients</div><div class="s">${r.groups.length > 1 ? 'grouped by the pot they go into' : `for ${S.servings}`}</div></div>
      ${vid ? `<div class="vthumb"><img src="https://i.ytimg.com/vi/${vid}/mqdefault.jpg" alt="" width="160" height="90" onerror="this.style.display='none'"><div><div class="k">${I.video(18)} YouTube mode</div><div class="t">The video plays one step at a time and waits for you at the end of each step.</div></div></div>` : ''}
      <div class="ing-grid${builtin ? '' : ' scroll'}">${groups}</div>
      ${r.finishLine ? `<div style="font-size:18px;color:var(--ink2)">${T(r.finishLine)}</div>` : ''}
      ${S.notes[0] ? `<div class="card lastnote">${I.mic(22, '#171B20')}<div><div class="k">Your note from last time</div><div class="t">“${esc(S.notes[0])}”</div></div></div>` : ''}
    </div>
  </div>`;
}

function doneView() {
  const saved = S.notes[0];
  const n = R().pots.length;
  const flames = n === 1 ? 'Check that the flame is off' : n === 2 ? 'Check that both flames are off' : 'Check that all three flames are off';
  return `<div class="cook">
    <div class="topbar"><div class="title"><div class="a">${esc(R().title)}</div><div class="b">${S.servings} servings</div></div><div class="progress"><div class="lbl">All ${STEPS().length} steps done</div><div class="segs${STEPS().length > 16 ? ' tight' : ''}">${STEPS().map(() => '<div class="seg done"></div>').join('')}</div></div>${pills()}</div>
    <div class="main" style="grid-template-columns:minmax(0,1fr) 460px">
      <div style="display:flex;flex-direction:column;justify-content:space-between;gap:20px;padding:8px 4px 0">
        <div style="display:flex;flex-direction:column;gap:14px"><h1 style="margin:0;font-size:96px;line-height:0.98;font-weight:800;letter-spacing:-0.02em">${esc(R().doneTitle)}</h1><div style="font-size:30px;line-height:1.3;color:#2B3036">${esc(R().doneLine)}</div></div>
        <div class="card" style="padding:24px 28px;display:flex;flex-direction:column;gap:16px">
          <div class="sec">Before you sit down</div>
          <div style="display:flex;align-items:center;gap:12px;font-size:28px;font-weight:700">${I.flameOff(32, '#171B20')}<div>${flames}</div></div>
        </div>
      </div>
      <div style="background:var(--ink);color:#fff;border-radius:28px;padding:30px 32px;display:flex;flex-direction:column;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;align-items:center;gap:12px"><div style="width:48px;height:48px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center">${I.mic(26, '#171B20')}</div><div class="sec" style="color:#fff">Note for next time</div></div>
          <div style="font-size:26px;line-height:1.35;color:#C9CCD1">Say what you'd change. It's saved with this recipe.</div>
        </div>
        ${saved ? `<div style="display:flex;flex-direction:column;gap:12px"><div style="font-size:22px;color:#C9CCD1">Heard</div><div style="font-size:34px;font-weight:700;line-height:1.2">“${esc(saved)}”</div><div class="saved">${I.check(26, '#fff')}<div>Saved for next time</div></div></div>` : '<div style="font-size:24px;color:#C9CCD1">Listening for your note…</div>'}
        <div style="font-size:20px;color:#C9CCD1">Say <b style="color:#fff">“khatam karo”</b> to close Cook-Along</div>
      </div>
    </div><div style="height:48px"></div></div>`;
}

// ---------------------------------------------------------------- rendering into stable layers
// The screen is split into layers that are only rewritten when their own HTML changes, so the 200 ms tick
// never rebuilds the whole screen: no flicker, no restarted animations, no lost taps.
function setHTML(el, html) {
  if (!el || el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

// Overlays fade in once when something new appears (a new alert, a new sheet), not on every content update.
function setLayer(el, key, html) {
  if (!el) return;
  if (el._key !== key) {
    el._key = key;
    el.classList.remove('enter');
    if (key) { void el.offsetWidth; el.classList.add('enter'); }
  }
  setHTML(el, html);
}

// The video lives outside the re-rendered layers (an iframe that is re-created would restart), so the
// layouts only leave a hole for it and CSS places it by the stage's layout name.
const root = document.getElementById('stageRoot');
let mounted = null;
function mount(layout) {
  if (stage.dataset.layout !== layout) stage.dataset.layout = layout;
  if (mounted === layout && root.firstElementChild) return;
  mounted = layout;
  if (layout === 'screen') { root.innerHTML = '<div id="Lscreen" class="slot"></div>'; return; }
  const mid = layout === 'tadka'
    ? '<div id="Lbeats" class="slot"></div><div id="Lbeatbody" class="slot"></div>'
    : layout === 'near' || layout === 'vnear'
      ? '<div class="main"><div id="Lback" class="slot"></div><div id="Lstep" class="slot"></div><div id="Lnext" class="slot"></div></div>'
      : '<div class="main"><div id="Lstep" class="slot"></div><div id="Lrail" class="slot"></div></div>';
  root.innerHTML = `<div class="cook ${layout === 'vfar' ? 'far video' : layout === 'vnear' ? 'near video' : layout}"><div id="Ltop" class="slot"></div>${mid}<div id="Lbottom" class="slot"></div></div>`
    + '<div id="Lover"><div id="Lhud" class="layer hud"></div><div id="Lsheet" class="layer full"></div><div id="Lalert" class="layer full"></div></div>';
}

const lib = libraryScreens({ S, render: () => render(), openRecipe, store, log });
const tour = createTour({
  S, DAL: DAL_TADKA, store, render: () => render(), fit: () => fit(), openRecipe, startCooking, goToStep, handleIntent, addWhistle, showRecap, finish, stopSpeaking,
  thumbsUp: () => gestures.h.onThumb(),
});

function render() {
  const $ = (id) => document.getElementById(id);
  if (S.screen !== 'cook') closeVideo();
  if (['library', 'add', 'review'].includes(S.screen)) {
    mount('screen');
    setHTML($('Lscreen'), lib.view());
  } else if (S.screen === 'start' || S.screen === 'done') {
    mount('screen');
    setHTML($('Lscreen'), S.screen === 'start' ? startView() : doneView());
  } else {
    const st = step();
    const vid = videoOn() && !st.beats;
    const layout = st.beats ? 'tadka' : isNear() ? (vid ? 'vnear' : 'near') : (vid ? 'vfar' : 'far');
    mount(layout);
    if (vid) ensureVideo(); else closeVideo();
    setHTML($('Ltop'), topbar());
    if (layout === 'tadka') {
      setHTML($('Lbeats'), beatStrip(st));
      setHTML($('Lbeatbody'), beatBody(st));
    } else {
      setHTML($('Lstep'), vid ? videoStepBody(st) : stepBody(st));
      if (layout === 'far' || layout === 'vfar') setHTML($('Lrail'), railView());
      else { setHTML($('Lback'), backHold()); setHTML($('Lnext'), nextHold()); }
    }
    setHTML($('Lbottom'), bottomBar(st));
    if (vid) placeVideo();
    const hud = S.engaged && !S.alert && !S.sheet;
    setLayer($('Lhud'), hud ? `hud${S.engagedAt}` : null, hud ? gestureHud() : '');
    setLayer($('Lsheet'), S.sheet ? `sheet${S.sheet.created}` : null, sheetView());
    setLayer($('Lalert'), S.alert ? `alert${S.alert.since}` : null, alertView());
    // Overlays cover the video too.
    const vis = S.alert || S.sheet || hud ? 'hidden' : 'visible';
    if (videoHost && videoHost.style.visibility !== vis) videoHost.style.visibility = vis;
  }
  if (demoEl.classList.contains('open')) renderDemoStatus();
}

// ---------------------------------------------------------------- stage scaling
function fit() {
  // The tour bar sits above the tablet screen, never on it, so the screen shrinks to make room.
  const bar = document.getElementById('tourBar');
  const top = document.body.classList.contains('touring') && bar ? bar.offsetHeight : 0;
  document.getElementById('viewport').style.top = `${top}px`;
  const availH = window.innerHeight - top;
  // A phone held upright gets its own layout: a 600 px wide screen as tall as the phone, instead of the
  // tablet screen shrunk to a third of its size.
  const portrait = window.innerWidth < availH * 0.85;
  const W = portrait ? 600 : 1180;
  const H = portrait ? Math.max(900, Math.round(availH * 600 / window.innerWidth)) : 820;
  if (stage.classList.contains('portrait') !== portrait) { stage.classList.toggle('portrait', portrait); stage.querySelectorAll('.slot, .layer').forEach((el) => { el._html = null; el._key = undefined; }); }
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  const s = Math.min(window.innerWidth / W, availH / H);
  stage.style.transform = `scale(${s})`;
  placeVideo();
}

// The video player sits outside the re-rendered layers, over the empty .vframe the layout leaves for it.
function placeVideo() {
  if (!videoHost) return;
  const f = stage.querySelector('.vframe');
  if (!f) return;
  let x = 0; let y = 0;
  for (let el = f; el && el !== stage; el = el.offsetParent) { x += el.offsetLeft; y += el.offsetTop; }
  const css = `${x}px,${y}px,${f.offsetWidth}px,${f.offsetHeight}px`;
  if (videoHost._pos === css) return;
  videoHost._pos = css;
  Object.assign(videoHost.style, { left: `${x}px`, top: `${y}px`, width: `${f.offsetWidth}px`, height: `${f.offsetHeight}px` });
}
window.addEventListener('resize', fit);
fit();
window.addEventListener('online', () => { S.online = true; render(); });
window.addEventListener('offline', () => { S.online = false; render(); });
// A tablet can be locked or the tab closed at any moment: save on the way out.
window.addEventListener('pagehide', persistNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistNow(); });

// ---------------------------------------------------------------- demo controls (for testing and recording)
function renderDemo() {
  demoEl.innerHTML = `
    <h3>Demo controls</h3>
    <div style="color:#AAB0B7;margin-bottom:8px">For testing and recording. Keyboard: → next, ← back, W whistle, L loud, N near, P palm, T thumbs up, A away, H help, D this panel.</div>
    <div class="row">
      <button data-d="whistle">Whistle (W)</button>
      <button data-d="loud" class="${S.loudOverride ? 'on' : ''}">Too loud (L)</button>
      <button data-d="near" class="${S.nearOverride ? 'on' : ''}">Near (N)</button>
      <button data-d="palm">Palm + swipe (P)</button>
      <button data-d="thumb">Thumbs up (T)</button>
      <button data-d="away">Away / back (A)</button>
    </div>
    <label>Timer speed</label>
    <div class="row">${[1, 10, 30].map((v) => `<button data-speed="${v}" class="${S.speed === v ? 'on' : ''}">×${v}</button>`).join('')}<button data-d="skip">Timers to 0:05</button></div>
    <label>Jump to step</label>
    <div class="row">${STEPS().map((_, i) => `<button data-jump="${i}">${i + 1}</button>`).join('')}</div>
    <label>Voice language</label>
    <div class="row"><button data-lang="en-IN" class="${S.flags.lang === 'en-IN' ? 'on' : ''}">English (India)</button><button data-lang="hi-IN" class="${S.flags.lang === 'hi-IN' ? 'on' : ''}">Hindi (India)</button></div>
    <label>Mic level · noise floor <span id="dlvl"></span></label>
    <div class="meter"><i id="dmeter" style="width:0%"></i></div>
    <label>Too loud above (dBFS floor): <span id="dloudv">${CFG.loudDb}</span></label>
    <input type="range" min="-70" max="-10" value="${CFG.loudDb}" data-cfg="loudDb">
    <label>Whistle above (dBFS): <span id="dwhv">${CFG.whistleDb}</span></label>
    <input type="range" min="-60" max="-5" value="${CFG.whistleDb}" data-cfg="whistleDb">
    <label>Near when face width is over: <span id="dnearv">${CFG.nearEnter}</span> of the frame</label>
    <input type="range" min="0.05" max="0.6" step="0.01" value="${CFG.nearEnter}" data-cfg="nearEnter">
    <div style="color:#AAB0B7;margin:4px 0 8px">Tuned values are saved on this device.</div>
    <label>Status</label>
    <div class="log" id="dstatus"></div>
    <label>Camera</label>
    <video id="dcam" playsinline muted></video>
    <label>Log</label>
    <div class="log" id="dlog"></div>`;
  const v = demoEl.querySelector('#dcam');
  if (camEl.srcObject) { v.srcObject = camEl.srcObject; v.play().catch(() => {}); }
  renderDemoStatus();
  renderDemoLog();
}
function renderDemoStatus() {
  const el = demoEl.querySelector('#dstatus');
  if (!el) return;
  el.textContent = `voice: ${S.voiceState} (${S.flags.lang})\ncamera: ${S.camState}  near: ${isNear()}  face: ${(S.faceRatio || 0).toFixed(2)}  engaged: ${S.engaged}\nmic: ${S.micState}  loud: ${isLoud()}  whistle band: ${S.level.ratio.toFixed(2)}${videoId() ? `\nvideo: ${videoCtl ? (videoCtl.ready ? `state ${videoCtl.state} at ${fmtTime(S.video.time)}` : 'loading') : 'off'}` : ''}`;
  const m = demoEl.querySelector('#dmeter');
  if (m) m.style.width = `${Math.max(0, Math.min(100, (S.level.db + 80) * 1.25))}%`;
  const l = demoEl.querySelector('#dlvl');
  if (l) l.textContent = `${S.level.db.toFixed(0)} / ${S.level.floor.toFixed(0)} dBFS`;
}
function renderDemoLog() { const el = demoEl.querySelector('#dlog'); if (el) el.textContent = S.log.join('\n'); }

function demoAction(a) {
  if (a === 'whistle') addWhistle('demo');
  if (a === 'loud') S.loudOverride = S.loudOverride ? null : true;
  if (a === 'near') S.nearOverride = !isNear();
  if (a === 'palm') { S.engaged = true; S.engagedAt = Date.now(); setTimeout(() => { if (S.engaged) { S.engaged = false; next({ kind: 'gesture', label: 'Swiped left' }); } }, 1400); }
  if (a === 'thumb') gestures.h.onThumb();
  if (a === 'away') {
    if (!S.awaySince) { S.awaySince = Date.now(); log('demo: away'); }
    else showRecap();
  }
  if (a === 'skip') for (const t of Object.values(S.timers)) if (t.type !== 'whistle' && t.state !== 'done' && t.state !== 'due') t.endsAt = Math.min(t.endsAt, S.clock + 5000);
  if (a === 'help') openSheet('help', { until: Date.now() + 12000 });
  render();
  if (demoEl.classList.contains('open')) renderDemo();
}

demoEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.d) demoAction(b.dataset.d);
  if (b.dataset.speed) { S.speed = Number(b.dataset.speed); renderDemo(); }
  if (b.dataset.jump) { const i = Number(b.dataset.jump); S.entered[i] = false; if (S.screen !== 'cook') startCooking(); goToStep(i, { force: true, quiet: true }); render(); }
  if (b.dataset.lang) { S.flags.lang = b.dataset.lang; saveSettings(); if (S.screen === 'cook') startVoice(); renderDemo(); }
});
demoEl.addEventListener('input', (e) => {
  const k = e.target.dataset.cfg;
  if (!k) return;
  CFG[k] = Number(e.target.value);
  saveSettings();
  const lbl = demoEl.querySelector({ loudDb: '#dloudv', whistleDb: '#dwhv', nearEnter: '#dnearv' }[k]);
  if (lbl) lbl.textContent = CFG[k];
});
document.getElementById('demoFab').addEventListener('click', () => { demoEl.classList.toggle('open'); if (demoEl.classList.contains('open')) renderDemo(); });

window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
  unlockAudio();
  if (S.needsTouch) { S.needsTouch = false; render(); }
  const k = e.key.toLowerCase();
  if (k === 'd') { demoEl.classList.toggle('open'); if (demoEl.classList.contains('open')) renderDemo(); return; }
  if (S.screen === 'start' && (k === 'enter' || k === ' ')) { startCooking(); render(); return; }
  if (S.screen !== 'cook' && S.screen !== 'done') return;
  if (k === 'arrowright' || k === ' ') { e.preventDefault(); if (S.alert) ackAlert({ kind: 'key' }); else next({ kind: 'key' }); }
  else if (k === 'arrowleft') back({ kind: 'key' });
  else if (k === 'w') demoAction('whistle');
  else if (k === 'l') demoAction('loud');
  else if (k === 'n') demoAction('near');
  else if (k === 'p') demoAction('palm');
  else if (k === 't') demoAction('thumb');
  else if (k === 'a') demoAction('away');
  else if (k === 'h') demoAction('help');
  else if (k === 'u') undo({ kind: 'key' });
  else if (k === 'enter') { if (!ackAlert({ kind: 'key' })) closeSheet(); }
  else if (k === 'v' && videoCtl) { if (videoCtl.playing()) videoCtl.pause(); else { S.video.waiting = false; videoCtl.play(); } }
  persistNow();
  render();
});

// Test hook: lets an automated check drive the app without a mic or camera.
window.__cookAlong = {
  get tour() { return tour; },
  S, CFG, handleIntent, parseCommand, addWhistle, next, back, startCooking, render, goToStep, openRecipe, store, safeSpoken, onTranscript,
  get video() { return videoCtl; },
};

// ---------------------------------------------------------------- boot
const settings = store.loadSettings({});
if (settings.flags) Object.assign(S.flags, settings.flags);
if (settings.cfg) Object.assign(CFG, settings.cfg);
S.notes = store.getNotes(S.recipe.id);
const saved = store.loadSession();
if (/[?&]tour=1\b/.test(location.search)) {
  store.clearSession();
  setTimeout(() => tour.start(), 0);
} else if (!(saved && resumeSession(saved))) {
  // A link like /#recipe=dal-tadka opens that recipe's page (used by the installed app's shortcut).
  const m = location.hash.match(/recipe=([\w-]+)/);
  const r = m && store.getRecipe(m[1]);
  if (r) openRecipe(r);
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};
render();
setInterval(tick, 200);

// Offline support: the service worker keeps the app, fonts and vision models on the device after the first visit.
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/[?&]nosw\b/.test(location.search)) {
  navigator.serviceWorker.register('sw.js').catch((e) => log(`offline cache: ${e.message}`));
}
