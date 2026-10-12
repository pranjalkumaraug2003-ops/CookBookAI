// Cook-Along QA lab. One page, several modes (?mode=...):
//   env           machine facts: browser, camera, microphone, GPU, voices, speech recognition, gesture model
//   mpbench       gesture/face model load and speed, GPU vs CPU, for one MediaPipe version (?mp=pinned|latest|x.y.z)
//   gesture       guided session: a person makes each gesture at three distances; every frame is logged
//   voice         guided session: a person says each command; every recognition result is logged
//   voice-replay  automated: recognition of a recorded file fed in as the microphone (no person)
//   tts           a person listens to every read-aloud voice and rates it
//   convert       automated: decodes real whistle recordings (any format) into WAV for the fake microphone
// It uses the app's own GestureInterpreter, NearDetector and parseCommand, so what it measures is what the app does.
// Nothing here is uploaded: recordings are saved under qa/out on this computer through the test runner.
import { GestureInterpreter, NearDetector } from '../../sensing.js';
import { parseCommand } from '../../voice.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MODE = params.get('mode') || 'env';
const QUICK = params.get('quick') === '1';
const BRIDGE = typeof window.qaSave === 'function';
window.__qa = { done: false, step: 'starting', results: { mode: MODE, params: Object.fromEntries(params), startedAt: new Date().toISOString(), userAgent: navigator.userAgent, bridge: BRIDGE } };
const RES = window.__qa.results;

// ---------------------------------------------------------------- small helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 1000) / 1000);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pctl = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const errText = (e) => String((e && (e.name ? `${e.name}: ` : '') + (e.message || e)) || e).slice(0, 300);

function setStep(s) { window.__qa.step = s; $('status').textContent = s; }
function logLine(s) {
  const el = $('log');
  el.textContent = `${new Date().toLocaleTimeString()}  ${s}\n${el.textContent}`.slice(0, 12000);
  if (window.qaLog) window.qaLog(`[${MODE}] ${s}`);
}
function show(big, sub = '', cls = '') { const b = $('big'); b.textContent = big; b.className = `big ${cls}`; $('sub').textContent = sub; }
function setCount(t) { $('count').textContent = t == null ? '' : String(t); }
function setBar(p) { $('barFill').style.width = `${Math.max(0, Math.min(1, p)) * 100}%`; }
function buttons(list) {
  const el = $('btns');
  el.innerHTML = '';
  for (const b of list) {
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = b.label; x.className = b.cls || ''; if (b.id) x.id = b.id;
    x.onclick = b.onClick;
    el.appendChild(x);
  }
}
// Resolves with the id of the button pressed, or 'auto' when autoMs runs out (for steps done from the stove).
function waitChoice(list, { autoMs = 0, autoLabel = '' } = {}) {
  return new Promise((resolve) => {
    let over = false;
    const end = (v) => { if (over) return; over = true; buttons([]); setCount(''); setBar(0); resolve(v); };
    buttons(list.map((b) => ({ ...b, onClick: () => end(b.id) })));
    if (autoMs) {
      const t0 = performance.now();
      const tick = () => {
        if (over) return;
        const left = autoMs - (performance.now() - t0);
        if (left <= 0) { end('auto'); return; }
        setCount(Math.ceil(left / 1000)); setBar(1 - left / autoMs);
        if (autoLabel) $('sub').dataset.auto = autoLabel;
        setTimeout(tick, 100);
      };
      tick();
    }
  });
}
async function countdown(secs, onTick) {
  const t0 = performance.now(); const ms = secs * 1000;
  for (;;) {
    const el = performance.now() - t0;
    if (el >= ms) break;
    setCount(Math.ceil((ms - el) / 1000)); setBar(el / ms);
    if (onTick) onTick(el);
    await sleep(100);
  }
  setCount(''); setBar(0);
}

let actx = null;
function audio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
function beep(freq = 880, ms = 160, gain = 0.25) {
  try {
    const c = audio(); const o = c.createOscillator(); const g = c.createGain();
    o.frequency.value = freq; g.gain.value = gain; o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + ms / 1000);
  } catch (_) { /* no audio */ }
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
async function saveBytes(rel, u8) {
  if (!BRIDGE) return false;
  if (!u8.length) { await window.qaSave(rel, '', false); return true; }
  const CH = 1 << 21;
  for (let i = 0; i < u8.length; i += CH) await window.qaSave(rel, b64(u8.subarray(i, i + CH)), i > 0);
  return true;
}
const saveJson = (rel, obj) => saveBytes(rel, new TextEncoder().encode(JSON.stringify(obj)));

function download() {
  const blob = new Blob([JSON.stringify(RES, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `cookalong-qa-${MODE}-${Date.now()}.json`;
  document.body.appendChild(a); a.click();
}
function finish(msg) {
  RES.finishedAt = new Date().toISOString();
  window.__qa.done = true;
  setStep('finished');
  if (!BRIDGE) download();
  show('Done. Thank you!', msg || (BRIDGE ? 'Results saved. Tell the agent this part is finished.' : 'A results file was downloaded. Give it to the agent.'));
  buttons([]); setCount('');
}
function fail(e) {
  RES.fatal = errText(e);
  logLine(`FATAL ${RES.fatal}`);
  window.__qa.done = true;
  setStep('failed');
  if (!BRIDGE) download();
  show('Something went wrong', RES.fatal, 'wait');
}

// ---------------------------------------------------------------- voices (read-aloud)
function getVoices(timeout = 3000) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve([]); return; }
    const v = speechSynthesis.getVoices();
    if (v.length) { resolve(v); return; }
    const t = setTimeout(() => resolve(speechSynthesis.getVoices()), timeout);
    speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); resolve(speechSynthesis.getVoices()); }, { once: true });
  });
}
// Mirrors pickVoice() in voice.js, so the report names the voice the app really uses.
function appPick(voices, langPrefix) {
  return voices.find((v) => v.lang && v.lang.toLowerCase() === langPrefix.toLowerCase())
    || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix.slice(0, 2).toLowerCase()))
    || null;
}
const vInfo = (v) => (v ? { name: v.name, lang: v.lang, local: v.localService, uri: v.voiceURI, isDefault: v.default } : null);

// ---------------------------------------------------------------- speech recognition
const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
async function probeSR() {
  const o = { supported: !!SRClass, unprefixed: !!window.SpeechRecognition };
  if (!SRClass) return o;
  const proto = SRClass.prototype;
  o.processLocallyProp = 'processLocally' in proto;
  o.phrasesProp = 'phrases' in proto;
  o.phraseClass = typeof window.SpeechRecognitionPhrase === 'function';
  o.availableFn = typeof SRClass.available === 'function';
  o.installFn = typeof SRClass.install === 'function';
  if (o.availableFn) {
    o.onDevice = {}; o.cloud = {};
    for (const lang of ['en-IN', 'hi-IN', 'en-US']) {
      try { o.onDevice[lang] = await SRClass.available({ langs: [lang], processLocally: true }); } catch (e) { o.onDevice[lang] = `error: ${errText(e)}`; }
      try { o.cloud[lang] = await SRClass.available({ langs: [lang], processLocally: false }); } catch (e) { o.cloud[lang] = `error: ${errText(e)}`; }
    }
  }
  return o;
}

// One continuous recognizer, set up the way voice.js sets up the app's (continuous, 3 alternatives,
// restart on end), but with interim results on so the time to the first word can be measured.
function makeRecognizer(lang, { phrases = null, local = false } = {}) {
  const st = { lang, results: [], errors: [], events: [], restarts: 0, wanted: true, audioStartT: null, phrasesSet: false, local: false };
  if (!SRClass) { st.errors.push({ t: 0, error: 'unsupported' }); return { st, stop() {} }; }
  const rec = new SRClass();
  rec.lang = lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 3;
  if (phrases) {
    try { rec.phrases = phrases.map((p) => new window.SpeechRecognitionPhrase(p, 5.0)); st.phrasesSet = true; } catch (e) { st.phrasesError = errText(e); }
  }
  if (local) { try { rec.processLocally = true; st.local = true; } catch (e) { st.localError = errText(e); } }
  const now = () => performance.now();
  rec.onstart = () => st.events.push(['start', Math.round(now())]);
  rec.onaudiostart = () => { if (st.audioStartT == null) st.audioStartT = now(); st.events.push(['audiostart', Math.round(now())]); };
  rec.onspeechstart = () => st.events.push(['speechstart', Math.round(now())]);
  rec.onerror = (e) => { st.errors.push({ t: Math.round(now()), error: e.error, message: e.message || '' }); logLine(`recognition error: ${e.error}`); if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(e.error)) st.wanted = false; };
  rec.onend = () => {
    st.events.push(['end', Math.round(now())]);
    if (st.wanted) { st.restarts++; setTimeout(() => { try { rec.start(); } catch (_) { /* already running */ } }, 250); }
  };
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]; const alts = [];
      for (let j = 0; j < r.length; j++) alts.push({ t: r[j].transcript, c: r3(r[j].confidence || 0) });
      st.results.push({ t: now(), final: r.isFinal, alts });
      if (r.isFinal) logLine(`heard${r.isFinal ? '' : ' (interim)'}: “${alts.map((a) => a.t).join(' | ')}”`);
    }
  };
  try { rec.start(); } catch (e) { st.errors.push({ t: Math.round(now()), error: 'start-failed', message: errText(e) }); }
  return { st, stop() { st.wanted = false; try { rec.stop(); } catch (_) { /* not running */ } } };
}

// ---------------------------------------------------------------- camera and MediaPipe
const PINNED = '0.10.14'; // the version sensing.js loads
const MODEL = {
  gesture: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
  face: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
};
async function resolveVersion(v) {
  if (!v || v === 'pinned') return PINNED;
  if (v !== 'latest') return v;
  try {
    const r = await fetch('https://data.jsdelivr.com/v1/packages/npm/@mediapipe/tasks-vision/resolved?specifier=latest');
    const j = await r.json();
    return j.version || 'latest';
  } catch (_) { return 'latest'; }
}
async function loadLib(version) {
  const base = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}`;
  const t0 = performance.now();
  const vision = await import(`${base}/vision_bundle.mjs`);
  const t1 = performance.now();
  const fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
  return { vision, fileset, version, importMs: Math.round(t1 - t0), filesetMs: Math.round(performance.now() - t1) };
}
async function createTask(lib, kind, delegate) {
  const Task = kind === 'gesture' ? lib.vision.GestureRecognizer : lib.vision.FaceDetector;
  const t0 = performance.now();
  try {
    const task = await Task.createFromOptions(lib.fileset, { baseOptions: { modelAssetPath: MODEL[kind], delegate }, runningMode: 'VIDEO', ...(kind === 'gesture' ? { numHands: 1 } : {}) });
    return { task, delegate, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { task: null, delegate, ms: Math.round(performance.now() - t0), error: errText(e) };
  }
}
// The app tries GPU and silently falls back to CPU; this records which one it ended up with, and why.
async function createLikeApp(lib, kind, forced) {
  if (forced && forced !== 'auto') return createTask(lib, kind, forced);
  const g = await createTask(lib, kind, 'GPU');
  if (g.task) return g;
  const c = await createTask(lib, kind, 'CPU');
  return { ...c, gpuError: g.error };
}
function handOf(res) {
  const lm = res && res.landmarks && res.landmarks[0];
  if (!lm) return null;
  const g = res.gestures && res.gestures[0] && res.gestures[0][0];
  const hd = (res.handedness || res.handednesses || [])[0];
  const side = hd && hd[0];
  let minX = 1; let maxX = 0; let minY = 1; let maxY = 0;
  for (const p of lm) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  return { name: g ? g.categoryName : 'None', score: g ? g.score : 0, x: lm[0].x, y: lm[0].y, w: maxX - minX, h: maxY - minY, side: side ? side.categoryName : null, lm };
}

async function openCamera() {
  const video = $('cam');
  // Same request as startCamera() in sensing.js.
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  for (let i = 0; i < 50 && !(video.readyState >= 2 && video.videoWidth > 0); i++) await sleep(100);
  const track = stream.getVideoTracks()[0];
  let caps = null; try { caps = track.getCapabilities ? track.getCapabilities() : null; } catch (_) { /* not supported */ }
  return { stream, video, label: track.label, settings: track.getSettings(), capabilities: caps };
}
async function measureFps(video, ms = 2500) {
  if (!video.requestVideoFrameCallback) return null;
  let n = 0; const t0 = performance.now();
  await new Promise((resolve) => {
    const cb = () => { n++; if (performance.now() - t0 < ms) video.requestVideoFrameCallback(cb); else resolve(); };
    video.requestVideoFrameCallback(cb);
    setTimeout(resolve, ms + 1500);
  });
  return Math.round(n / (ms / 1000) * 10) / 10;
}
async function benchTask(created, kind, video, frames = 40) {
  const o = { delegate: created.delegate, createMs: created.ms, createError: created.error || null, gpuError: created.gpuError || null, calls: 0, errors: 0, firstError: null, found: 0, cats: {}, ms: [] };
  if (!created.task) return o;
  for (let i = 0; i < frames; i++) {
    await sleep(66);
    const t = performance.now();
    try {
      if (kind === 'gesture') { const h = handOf(created.task.recognizeForVideo(video, t)); if (h) { o.found++; o.cats[h.name] = (o.cats[h.name] || 0) + 1; } }
      else { const f = created.task.detectForVideo(video, t); if (f.detections && f.detections.length) o.found++; }
      o.ms.push(performance.now() - t);
    } catch (e) { o.errors++; if (!o.firstError) o.firstError = errText(e); }
    o.calls++;
  }
  const ms = o.ms; delete o.ms;
  o.msMedian = r3(median(ms)); o.msP95 = r3(pctl(ms, 0.95));
  try { created.task.close(); } catch (_) { /* ignore */ }
  return o;
}
function webglInfo() {
  try {
    const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { webgl: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { webgl: true, webgl2: !!c.getContext('webgl2'), vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  } catch (e) { return { error: errText(e) }; }
}

// ---------------------------------------------------------------- mode: env
async function modeEnv() {
  setStep('collecting');
  show('Checking this computer', 'Camera, microphone, voices, speech recognition and the gesture model. About a minute. Nothing to do.');
  const e = RES.env = {};
  try { e.uaData = navigator.userAgentData ? await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'model', 'fullVersionList']) : null; } catch (_) { e.uaData = null; }
  e.cores = navigator.hardwareConcurrency || null; e.memoryGb = navigator.deviceMemory || null;
  e.screen = { w: screen.width, h: screen.height, dpr: devicePixelRatio, innerW: innerWidth, innerH: innerHeight };
  e.languages = navigator.languages; e.gpu = webglInfo();
  e.secureContext = isSecureContext;
  e.wakeLock = 'wakeLock' in navigator;
  logLine('basics done');

  setStep('microphone');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const t = s.getAudioTracks()[0];
    e.mic = { label: t.label, settings: t.getSettings() };
    const c = audio(); await sleep(200); const src = c.createMediaStreamSource(s); const an = c.createAnalyser(); an.fftSize = 2048; src.connect(an);
    e.mic.audioContextState = c.state;
    const buf = new Float32Array(an.fftSize); const lv = [];
    for (let i = 0; i < 30; i++) { await sleep(50); an.getFloatTimeDomainData(buf); let sum = 0; for (const v of buf) sum += v * v; lv.push(20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9)); }
    e.mic.roomLevelDb = { median: r3(median(lv)), max: r3(Math.max(...lv)) };
    e.mic.sampleRate = c.sampleRate;
    s.getTracks().forEach((x) => x.stop());
  } catch (err) { e.mic = { error: errText(err) }; }
  logLine('microphone done');

  setStep('camera');
  let cam = null;
  try {
    cam = await openCamera();
    e.camera = { label: cam.label, settings: cam.settings, capabilities: cam.capabilities, measuredFps: await measureFps(cam.video) };
  } catch (err) { e.camera = { error: errText(err) }; }
  try { e.devices = (await navigator.mediaDevices.enumerateDevices()).map((d) => ({ kind: d.kind, label: d.label })); } catch (err) { e.devices = { error: errText(err) }; }
  logLine('camera done');

  setStep('voices');
  const voices = await getVoices();
  e.voices = voices.map(vInfo);
  e.appVoice = { enIN: vInfo(appPick(voices, 'en-IN')), hiIN: vInfo(appPick(voices, 'hi-IN')) };
  e.voiceCounts = { total: voices.length, local: voices.filter((v) => v.localService).length, online: voices.filter((v) => !v.localService).length, hindi: voices.filter((v) => /^hi/i.test(v.lang)).length, enIN: voices.filter((v) => /^en-IN/i.test(v.lang)).length };
  logLine(`voices: ${voices.length}; app would use ${e.appVoice.enIN ? e.appVoice.enIN.name : 'none'} for English`);

  setStep('speech recognition');
  e.speechRecognition = await probeSR();

  setStep('gesture model (pinned version, like the app)');
  if (cam) {
    try {
      const lib = await loadLib(PINNED);
      e.mediapipe = { version: PINNED, importMs: lib.importMs, filesetMs: lib.filesetMs };
      e.mediapipe.gestureLikeApp = await benchTask(await createLikeApp(lib, 'gesture'), 'gesture', cam.video);
      e.mediapipe.gestureCPU = await benchTask(await createTask(lib, 'gesture', 'CPU'), 'gesture', cam.video);
      e.mediapipe.faceLikeApp = await benchTask(await createLikeApp(lib, 'face'), 'face', cam.video, 20);
    } catch (err) { e.mediapipe = { error: errText(err) }; }
    cam.stream.getTracks().forEach((t) => t.stop());
  }
  setStep('network');
  e.network = {};
  for (const [k, url] of Object.entries({ bundle: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${PINNED}/vision_bundle.mjs`, gestureModel: MODEL.gesture, faceModel: MODEL.face })) {
    const t0 = performance.now();
    try { const r = await fetch(url, { cache: 'no-store' }); const b = await r.arrayBuffer(); e.network[k] = { status: r.status, bytes: b.byteLength, ms: Math.round(performance.now() - t0) }; } catch (err) { e.network[k] = { error: errText(err), ms: Math.round(performance.now() - t0) }; }
  }
  finish('Environment check finished.');
}

// ---------------------------------------------------------------- mode: mpbench
async function modeMpBench() {
  const version = await resolveVersion(params.get('mp') || 'pinned');
  setStep(`MediaPipe ${version}`);
  show(`Gesture model speed check (${version})`, 'Stay in front of the camera and hold up an open hand now and then. About 30 seconds.');
  const cam = await openCamera();
  const lib = await loadLib(version);
  const b = RES.bench = { version, requested: params.get('mp') || 'pinned', importMs: lib.importMs, filesetMs: lib.filesetMs, camera: cam.settings };
  b.gestureLikeApp = await benchTask(await createLikeApp(lib, 'gesture'), 'gesture', cam.video, 60);
  b.gestureGPU = await benchTask(await createTask(lib, 'gesture', 'GPU'), 'gesture', cam.video, 60);
  b.gestureCPU = await benchTask(await createTask(lib, 'gesture', 'CPU'), 'gesture', cam.video, 60);
  b.faceLikeApp = await benchTask(await createLikeApp(lib, 'face'), 'face', cam.video, 30);
  cam.stream.getTracks().forEach((t) => t.stop());
  finish('Speed check finished.');
}

// ---------------------------------------------------------------- mode: gesture (guided)
const SEG = {
  idle: { expect: 'none', text: 'Stand still, hands down', sub: 'No gestures. Just stand where you would cook.', secs: 5 },
  palm: { expect: 'engage', text: 'Open palm, held still', sub: 'Fingers spread, palm facing the screen, until the time runs out.', secs: 4 },
  swipeL: { expect: 'swipe-left', text: 'Open palm, then swipe to YOUR LEFT', sub: 'Hold your palm up. At the high beep, move it to your left, about a forearm\'s length, at a normal speed.', secs: 7, cue: true },
  swipeR: { expect: 'swipe-right', text: 'Open palm, then swipe to YOUR RIGHT', sub: 'Hold your palm up. At the high beep, move it to your right, about a forearm\'s length, at a normal speed.', secs: 7, cue: true },
  thumb: { expect: 'thumb', text: 'Thumbs up, held for a second', sub: 'Like saying “done” to someone across the kitchen.', secs: 4 },
  cook: { expect: 'none', text: 'Cook normally: stir, reach, wipe your hands', sub: 'Pretend to cook. Do not make any gesture on purpose.', secs: 12 },
  walk: { expect: 'near-walk', text: 'Walk up to the screen, then back to the stove', sub: 'Slowly. Come within an arm\'s length, pause 2 seconds, then go back.', secs: 12 },
  away: { expect: 'away', text: 'Step out of the camera\'s view', sub: 'Stay out until you hear the beep.', secs: 14 },
};
const PLAN = QUICK ? [
  { group: 'near', where: 'about 2 ft (60 cm) from the screen, an arm\'s length', segs: ['swipeL', 'thumb'] },
  { group: 'counter', where: 'about 3 ft (1 m) from the screen, where you would chop', segs: ['idle', 'swipeL', 'swipeR', 'thumb', 'cook'] },
  { group: 'stove', where: 'about 5 ft (1.5 m) from the screen, where you stand at the stove', segs: ['swipeL', 'swipeR', 'thumb', 'cook'] },
] : [
  { group: 'near', where: 'about 2 ft (60 cm) from the screen, an arm\'s length', segs: ['idle', 'palm', 'swipeL', 'swipeR', 'thumb', 'swipeL', 'swipeR', 'thumb'] },
  { group: 'counter', where: 'about 3 ft (1 m) from the screen, where you would chop', segs: ['idle', 'palm', 'swipeL', 'swipeR', 'thumb', 'swipeL', 'swipeR', 'thumb', 'cook'] },
  { group: 'stove', where: 'about 5 ft (1.5 m) from the screen, where you stand at the stove', segs: ['palm', 'swipeL', 'swipeR', 'thumb', 'swipeL', 'swipeR', 'thumb', 'cook'] },
  { group: 'move', where: 'at the stove, about 5 ft (1.5 m) away', segs: ['walk', 'away'] },
];
// Recorded as video for replay into the real app: the first of each kind at counter and stove distance.
const RECORD = new Set(['counter:idle', 'counter:swipeL', 'counter:swipeR', 'counter:thumb', 'counter:cook', 'stove:swipeL', 'stove:swipeR', 'stove:thumb', 'stove:cook', 'move:walk', 'near:swipeL', 'near:thumb']);
const REC_FPS = 10;

function toI420(rgba, w, h) {
  const ySize = w * h; const cw = w >> 1; const ch = h >> 1;
  const out = new Uint8Array(ySize + 2 * cw * ch);
  for (let i = 0, p = 0; i < ySize; i++, p += 4) out[i] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) | 0;
  let u = ySize; let v = ySize + cw * ch;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const a = ((2 * y) * w + 2 * x) * 4; const b = a + 4; const c = a + w * 4; const d = c + 4;
      const r = (rgba[a] + rgba[b] + rgba[c] + rgba[d]) / 4;
      const g = (rgba[a + 1] + rgba[b + 1] + rgba[c + 1] + rgba[d + 1]) / 4;
      const bl = (rgba[a + 2] + rgba[b + 2] + rgba[c + 2] + rgba[d + 2]) / 4;
      out[u++] = Math.max(0, Math.min(255, -0.168736 * r - 0.331264 * g + 0.5 * bl + 128));
      out[v++] = Math.max(0, Math.min(255, 0.5 * r - 0.418688 * g - 0.081312 * bl + 128));
    }
  }
  return out;
}
async function flushY4m(file, frames, w, h) {
  const enc = new TextEncoder();
  const header = enc.encode(`YUV4MPEG2 W${w} H${h} F${REC_FPS}:1 Ip A1:1 C420jpeg\n`);
  const tag = enc.encode('FRAME\n');
  const total = header.length + frames.reduce((a, f) => a + tag.length + f.length, 0);
  const buf = new Uint8Array(total); let o = 0;
  buf.set(header, o); o += header.length;
  for (const f of frames) { buf.set(tag, o); o += tag.length; buf.set(f, o); o += f.length; }
  await saveBytes(file, buf);
  return total;
}

function summariseSeg(s) {
  const fr = s.frames; const n = fr.length;
  const dur = s.secs * 1000;
  const withHand = fr.filter((f) => f.n != null);
  const cats = {}; for (const f of withHand) cats[f.n] = (cats[f.n] || 0) + 1;
  const ms = fr.filter((f) => f.ms != null).map((f) => f.ms);
  const run = (pred) => {
    let best = 0; let start = null; let last = null;
    for (const f of fr) {
      if (pred(f)) { if (start == null) start = f.t; last = f.t; best = Math.max(best, last - start); } else { start = null; }
    }
    return best;
  };
  const types = s.events.map((e) => e.type);
  const actions = types.filter((t) => t.startsWith('swipe') || t === 'thumb');
  const o = {
    id: s.id, group: s.group, seg: s.seg, expect: s.expect, secs: s.secs,
    frames: n, fps: r3(n / (dur / 1000)), handPct: n ? Math.round(withHand.length / n * 100) : 0,
    // The same video time twice in a row means the model was handed a frame it had already seen.
    staleFramePct: n > 1 ? Math.round(fr.filter((f2, i) => i > 0 && f2.vt === fr[i - 1].vt).length / (n - 1) * 100) : null,
    cats, errors: fr.filter((f) => f.e).length, firstError: (fr.find((f) => f.e) || {}).e || null,
    msMedian: r3(median(ms)), msP95: r3(pctl(ms, 0.95)),
    handSizeMedian: r3(median(withHand.map((f) => f.w))),
    longestPalmMs: run((f) => f.n === 'Open_Palm' && f.s > 0.55),
    longestThumbMs: run((f) => f.n === 'Thumb_Up' && f.s > 0.6),
    meanScore: {},
    events: s.events, actions,
  };
  for (const name of Object.keys(cats)) { const sc = withHand.filter((f) => f.n === name).map((f) => f.s); o.meanScore[name] = r3(sc.reduce((a, b) => a + b, 0) / sc.length); }
  const eng = s.events.find((e) => e.type === 'engage');
  if (eng) {
    const before = [...fr].reverse().find((f) => f.t <= eng.t && f.x != null);
    const after = fr.filter((f) => f.t > eng.t && f.t <= eng.t + 3000);
    const xs = after.filter((f) => f.x != null).map((f) => f.x - (before ? before.x : f.x));
    o.afterEngage = {
      engageAtMs: eng.t,
      maxRight: r3(xs.length ? Math.max(...xs) : null), maxLeft: r3(xs.length ? Math.min(...xs) : null),
      framesNoHand: after.filter((f) => f.x == null).length, framesTotal: after.length,
      longestGapMs: (() => { let g = 0; let lastSeen = eng.t; for (const f of after) { if (f.x != null) { g = Math.max(g, f.t - lastSeen); lastSeen = f.t; } } return g; })(),
    };
  }
  if (s.faces.length) {
    const rs = s.faces.filter((f) => f.r != null).map((f) => f.r);
    o.face = { samples: rs.length, seenPct: rs.length ? Math.round(rs.filter((r) => r > 0).length / rs.length * 100) : 0, min: r3(rs.length ? Math.min(...rs) : null), max: r3(rs.length ? Math.max(...rs) : null), median: r3(median(rs.filter((r) => r > 0))) };
  }
  const want = s.expect;
  if (want === 'none') o.pass = actions.length === 0;
  else if (want === 'engage') o.pass = types.includes('engage');
  else if (want === 'swipe-left' || want === 'swipe-right') o.pass = actions[0] === want && actions.filter((a) => a !== want).length === 0;
  else if (want === 'thumb') o.pass = types.includes('thumb');
  else if (want === 'near-walk') o.pass = types.includes('near') && types.includes('far');
  else if (want === 'away') o.pass = types.includes('absent');
  o.result = o.pass ? 'pass' : 'fail';
  return o;
}

async function modeGesture() {
  const version = await resolveVersion(params.get('mp') || 'pinned');
  const forced = params.get('delegate') || 'auto';
  const G = RES.gesture = { version, delegateRequested: forced, quick: QUICK, segments: [], fixtures: [] };
  setStep('camera');
  show('Gesture lab', 'Opening the camera…');
  const cam = await openCamera();
  const { video } = cam;
  G.camera = { label: cam.label, settings: cam.settings, measuredFps: await measureFps(video, 1500) };
  $('previewWrap').hidden = false;
  const pv = $('preview'); pv.width = video.videoWidth; pv.height = video.videoHeight;
  const pctx = pv.getContext('2d');

  setStep('loading model');
  show('Loading the gesture model…', `MediaPipe ${version}`);
  const t0 = performance.now();
  const lib = await loadLib(version);
  const g = await createLikeApp(lib, 'gesture', forced);
  const f = await createLikeApp(lib, 'face', forced);
  G.load = { totalMs: Math.round(performance.now() - t0), importMs: lib.importMs, gestureDelegate: g.delegate, gestureError: g.error || null, gpuError: g.gpuError || null, faceDelegate: f.delegate, faceError: f.error || null };
  if (!g.task) throw new Error(`The gesture model did not load: ${g.error}`);
  logLine(`model ready: ${g.delegate}${g.gpuError ? ` (GPU failed: ${g.gpuError})` : ''}`);

  let cur = null; let interp = null; let near = null; let liveHand = null; let liveFace = 0; let lastHand = 0; let lastFace = 0; let running = true;
  const ev = (type) => {
    if (!cur) return;
    cur.events.push({ t: Math.round(performance.now() - cur.t0), type, x: liveHand ? r3(liveHand.x) : null });
    logLine(`event: ${type}`);
    if (type === 'engage' && cur.cue) beep(1320, 220, 0.35);
    if (type.startsWith('swipe') || type === 'thumb') beep(660, 120, 0.2);
  };
  const loop = () => {
    if (!running) return;
    const now = performance.now();
    if (video.readyState >= 2 && video.videoWidth > 0) {
      if (now - lastHand > 66) {
        lastHand = now;
        let h = null; let err = null; const c0 = performance.now();
        try { h = handOf(g.task.recognizeForVideo(video, now)); } catch (e) { err = errText(e); }
        const ms = performance.now() - c0;
        liveHand = h;
        if (cur) cur.frames.push({ t: Math.round(now - cur.t0), vt: r3(video.currentTime), n: h ? h.name : null, s: h ? r3(h.score) : null, x: h ? r3(h.x) : null, y: h ? r3(h.y) : null, w: h ? r3(h.w) : null, side: h ? h.side : null, ms: Math.round(ms * 10) / 10, e: err || undefined });
        if (interp && !err) interp.feed(h ? { name: h.name, score: h.score, x: h.x } : null, now);
      }
      if (f.task && now - lastFace > 450) {
        lastFace = now;
        try {
          const d = f.task.detectForVideo(video, now).detections[0];
          liveFace = d ? d.boundingBox.width / video.videoWidth : 0;
          if (cur) cur.faces.push({ t: Math.round(now - cur.t0), r: r3(liveFace) });
          if (near) near.feed(liveFace, now);
        } catch (e) { if (cur) cur.faces.push({ t: Math.round(now - cur.t0), e: errText(e) }); }
      }
      pctx.drawImage(video, 0, 0, pv.width, pv.height);
      if (liveHand) { pctx.fillStyle = '#F7C323'; for (const p of liveHand.lm) { pctx.beginPath(); pctx.arc(p.x * pv.width, p.y * pv.height, 4, 0, 7); pctx.fill(); } }
      $('live').textContent = liveHand ? `${liveHand.name} ${liveHand.score.toFixed(2)}  x ${liveHand.x.toFixed(2)}` : 'no hand';
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Frame grabber for the replay videos, at the camera's own size (capped at 640 wide).
  const grab = document.createElement('canvas');
  let gw = Math.min(640, video.videoWidth); let gh = Math.round(video.videoHeight * gw / video.videoWidth);
  gw -= gw % 2; gh -= gh % 2; grab.width = gw; grab.height = gh;
  const gctx = grab.getContext('2d', { willReadFrequently: true });

  setStep('waiting to start');
  show('Gesture lab', 'Put the laptop where it would stand in your kitchen, camera facing you. You should see yourself on the right. Then press Start (or ask the agent to). The screen will tell you what to do; beeps mark start and stop.');
  await waitChoice([{ id: 'start', label: 'Start', cls: 'primary' }]);
  audio(); beep(660, 100);

  const plan = PLAN;
  let segNo = 0;
  for (const grp of plan) {
    setStep(`move: ${grp.group}`);
    show(`Move to ${grp.where}`, 'Make sure the camera can see your hands and face. Starting by itself in 15 seconds.', 'wait');
    await waitChoice([{ id: 'go', label: 'I\'m there, start', cls: 'primary' }, { id: 'skip', label: 'Skip this distance' }], { autoMs: 15000 }).then(async (c) => { if (c === 'skip') grp.skipped = true; });
    if (grp.skipped) { logLine(`skipped ${grp.group}`); continue; }
    for (const segKey of grp.segs) {
      segNo++;
      const def = SEG[segKey];
      const id = `${grp.group}:${segKey}`;
      setStep(`${id} (${segNo})`);
      show(def.text, `Get ready. ${def.sub}`, 'wait');
      for (let i = 3; i > 0; i--) { setCount(i); beep(440, 90, 0.15); await sleep(1000); }
      setCount('');
      const record = BRIDGE && RECORD.has(id) && !G.fixtures.some((x) => x.id === id);
      cur = { id, group: grp.group, seg: segKey, expect: def.expect, secs: def.secs, cue: !!def.cue, t0: performance.now(), frames: [], faces: [], events: [], video: [] };
      interp = new GestureInterpreter({ onProgress: () => {}, onEngage: () => ev('engage'), onCancel: (w) => ev(`cancel-${w}`), onSwipe: (d) => ev(`swipe-${d}`), onThumb: () => ev('thumb') });
      near = new NearDetector((v) => ev(v ? 'near' : 'far'), { thresholds: () => ({ enter: 0.3, exit: 0.22 }) });
      near.onPresence = (p) => ev(p ? 'present' : 'absent');
      let grabber = null;
      if (record) {
        grabber = setInterval(() => {
          try { gctx.drawImage(video, 0, 0, gw, gh); cur.video.push(toI420(gctx.getImageData(0, 0, gw, gh).data, gw, gh)); } catch (_) { /* skip frame */ }
        }, 1000 / REC_FPS);
      }
      beep(990, 200, 0.3);
      show(def.text, def.sub, 'go');
      await countdown(def.secs);
      if (grabber) clearInterval(grabber);
      beep(520, 300, 0.3);
      const seg = cur; cur = null; interp = null; near = null;
      show('Stop. Relax.', record ? 'Saving the clip…' : '', 'wait');
      const sum = summariseSeg(seg);
      G.segments.push(sum);
      if (BRIDGE) await saveJson(`raw/gesture/${seg.group}-${seg.seg}-${segNo}.json`, { id, frames: seg.frames, faces: seg.faces, events: seg.events });
      else sum.raw = { frames: seg.frames, faces: seg.faces };
      if (record && seg.video.length) {
        const file = `fixtures/gestures/${seg.group}-${seg.seg}.y4m`;
        const bytes = await flushY4m(file, seg.video, gw, gh);
        G.fixtures.push({ id, file, group: seg.group, seg: seg.seg, expect: seg.expect, w: gw, h: gh, fps: REC_FPS, frames: seg.video.length, secs: seg.video.length / REC_FPS, bytes });
      }
      logLine(`${id}: ${sum.result} (${sum.actions.join(', ') || 'no action'}; hand in ${sum.handPct}% of frames)`);
      await sleep(1500);
    }
  }
  running = false;
  cam.stream.getTracks().forEach((t) => t.stop());
  if (BRIDGE) await saveJson('fixtures/gestures/manifest.json', G.fixtures);
  const s = G.segments;
  G.summary = { segments: s.length, passed: s.filter((x) => x.pass).length, byExpect: {} };
  for (const x of s) { const k = `${x.group}:${x.expect}`; G.summary.byExpect[k] = G.summary.byExpect[k] || { pass: 0, total: 0 }; G.summary.byExpect[k].total++; if (x.pass) G.summary.byExpect[k].pass++; }
  finish('Gesture session finished. You can come back to the computer.');
}

// ---------------------------------------------------------------- mode: voice (guided)
const CMD = [
  ['aage', 'next'], ['peeche', 'back'], ['phir se', 'repeat'], ['ruko', 'pause'], ['chalo', 'resume'], ['ho gaya', 'ack'],
  ['galat', 'undo'], ['haan', 'yes'], ['nahi', 'no'], ['namak kitna?', 'howmuch'], ['5 minute ka timer', 'timer'],
  ['6 logon ke liye', 'servings'], ['ek aur seeti', 'whistle'], ['kahan tha?', 'where'], ['cooking band karo', 'stop'], ['madad', 'help'],
  ['next', 'next'], ['back', 'back'], ['done', 'ack'], ['repeat', 'repeat'],
];
const CORE = [['aage', 'next'], ['peeche', 'back'], ['ho gaya', 'ack'], ['phir se', 'repeat'], ['ruko', 'pause'], ['chalo', 'resume'], ['galat', 'undo'], ['haan', 'yes']];
const CHATTER_HI = 'Aaj dinner mein dal tadka banana hai. Pehle dal ko dho ke cooker mein daala, saath mein haldi aur namak. Mummy keh rahi thi ki tamatar thode zyada daalna, isse swaad accha aata hai. Bazaar se dhaniya laana bhool gaya, kal yaad se le aaunga. Pyaaz kaatne mein aankhon se paani aa raha hai. Jeera aur lehsun ka tadka sabse zaroori hai, uski khushboo poore ghar mein phail jaati hai.';
const CHATTER_EN = 'The weather has been really nice this week. My friend called about the cricket match on Sunday, and we argued about the batting order. I need to buy tomatoes, onions and coriander tomorrow morning. The new chimney makes a lot of noise but it clears the smoke quickly.';

// Records the microphone at 16 kHz alongside recognition, so each spoken command can be replayed later.
async function startRecorder() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const c = audio(); const src = c.createMediaStreamSource(stream);
  const proc = c.createScriptProcessor(4096, 1, 1); const mute = c.createGain(); mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(c.destination);
  const ratio = c.sampleRate / 16000; const chunks = []; let total = 0; let phase = 0; let acc = 0; let accN = 0;
  const levels = [];
  proc.onaudioprocess = (e) => {
    const x = e.inputBuffer.getChannelData(0);
    let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    levels.push({ i: total, db: 20 * Math.log10(Math.sqrt(s / x.length) + 1e-9) });
    const out = new Int16Array(Math.ceil(x.length / ratio) + 2); let o = 0;
    for (let i = 0; i < x.length; i++) {
      acc += x[i]; accN++; phase += 1;
      if (phase >= ratio) { phase -= ratio; out[o++] = Math.max(-32768, Math.min(32767, Math.round(acc / accN * 32767))); acc = 0; accN = 0; }
    }
    chunks.push(out.subarray(0, o)); total += o;
  };
  return {
    mark: () => total,
    levelsBetween: (a, b) => levels.filter((l) => l.i >= a && l.i < b).map((l) => l.db),
    slice(a, b) {
      const outArr = new Int16Array(Math.max(0, b - a)); let pos = 0; let o = 0;
      for (const ch of chunks) {
        const s = Math.max(a, pos); const e2 = Math.min(b, pos + ch.length);
        if (e2 > s) { outArr.set(ch.subarray(s - pos, e2 - pos), o); o += e2 - s; }
        pos += ch.length;
        if (pos >= b) break;
      }
      return outArr;
    },
    stop() { proc.disconnect(); stream.getTracks().forEach((t) => t.stop()); },
  };
}
function wav16(int16, rate = 16000) {
  const b = new ArrayBuffer(44 + int16.length * 2); const v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + int16.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, int16.length * 2, true);
  new Int16Array(b, 44).set(int16);
  return new Uint8Array(b);
}
// Kitchen-like noise through the speakers: a fan's rumble and hiss, for the "noisy kitchen" round.
function startNoise(gain = 0.22) {
  const c = audio(); const len = c.sampleRate * 4; const buf = c.createBuffer(1, len, c.sampleRate); const d = buf.getChannelData(0);
  let b0 = 0; let b1 = 0; let b2 = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11 + 0.05 * Math.sin(2 * Math.PI * 100 * i / c.sampleRate); }
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true; const g = c.createGain(); g.gain.value = gain;
  src.connect(g).connect(c.destination); src.start();
  return () => { try { src.stop(); } catch (_) { /* stopped */ } };
}
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function analysePrompts(prompts, st) {
  return prompts.map((p, i) => {
    const end = prompts[i + 1] && prompts[i + 1].lang === p.lang && prompts[i + 1].round === p.round ? prompts[i + 1].t0 : p.t0 + 9000;
    const inWin = st.results.filter((r) => r.t >= p.t0 && r.t < end);
    const finals = inWin.filter((r) => r.final);
    let got = null;
    for (const fr of finals) {
      for (const a of fr.alts) { const c = parseCommand(a.t); if (c) { got = { intent: c.intent, from: a.t, conf: a.c, ms: Math.round(fr.t - p.t0) }; break; } }
      if (got) break;
    }
    return {
      round: p.round, lang: p.lang, say: p.say, expect: p.intent, file: p.file || null,
      heard: finals.map((fr) => fr.alts.map((a) => a.t)), topConfidence: finals[0] ? finals[0].alts[0].c : null,
      firstResultMs: inWin[0] ? Math.round(inWin[0].t - p.t0) : null, finalMs: finals[0] ? Math.round(finals[0].t - p.t0) : null,
      intent: got ? got.intent : null, matchedText: got ? got.from : null,
      pass: !!got && got.intent === p.intent,
      micDbMedian: p.db ? r3(median(p.db)) : null, micDbMax: p.db && p.db.length ? r3(Math.max(...p.db)) : null,
    };
  });
}

async function modeVoice() {
  const langs = (params.get('langs') || 'en-IN,hi-IN').split(',').map((s) => s.trim()).filter(Boolean);
  const V = RES.voice = { langs, quick: QUICK, features: await probeSR(), rounds: [], prompts: [], chatter: [], recognizerStats: [] };
  if (!SRClass) throw new Error('This browser has no speech recognition (SpeechRecognition).');
  setStep('waiting to start');
  show('Voice lab', 'You will see words to say, one at a time. Say each one once, in your normal voice, as you would while cooking. A beep means "say it now". Press Start (or ask the agent to).');
  await waitChoice([{ id: 'start', label: 'Start', cls: 'primary' }]);
  audio(); beep(660, 100);
  const rec = await startRecorder();
  const all = [];

  const runRound = async (round, list, lang, { recognizer, where, noise = false, saveAudio = true }) => {
    V.rounds.push({ round, lang, where, noise, count: list.length });
    let stopNoise = null;
    if (noise) stopNoise = startNoise();
    for (const [i, [say, intent]] of list.entries()) {
      setStep(`${round}: ${i + 1}/${list.length}`);
      show(`Say: “${say}”`, `${where}. Say it once, normally.`, 'go');
      beep(990, 120, 0.25);
      const a = rec.mark();
      const p = { round, lang, say, intent, t0: performance.now() };
      all.push(p);
      await countdown(5);
      show('…', 'Pause', 'wait');
      await sleep(2000);
      const b = rec.mark();
      p.db = rec.levelsBetween(a, b);
      if (saveAudio && BRIDGE) { p.file = `fixtures/voice/${lang}/${round}-${String(i + 1).padStart(2, '0')}-${slug(say)}.wav`; await saveBytes(p.file, wav16(rec.slice(a, b))); }
    }
    if (stopNoise) stopNoise();
    const res = analysePrompts(all.filter((p) => p.round === round && p.lang === lang), recognizer.st);
    V.prompts.push(...res);
    logLine(`${round} (${lang}): ${res.filter((r) => r.pass).length}/${res.length} understood`);
  };

  for (const [li, lang] of langs.entries()) {
    const recognizer = makeRecognizer(lang);
    await sleep(1200);
    if (li === 0) {
      await runRound('counter', QUICK ? CORE : CMD, lang, { recognizer, where: 'Stand about 3 ft (1 m) from the laptop' });
      if (!QUICK) {
        show('Move to the stove: about 5 ft (1.5 m) away', 'Starting by itself in 15 seconds.', 'wait');
        await waitChoice([{ id: 'go', label: 'I\'m there, start', cls: 'primary' }, { id: 'skip', label: 'Skip' }], { autoMs: 15000 }).then(async (c) => {
          if (c !== 'skip') await runRound('stove', CORE.slice(0, 6), lang, { recognizer, where: 'From the stove, about 5 ft (1.5 m) away' });
        });
        show('Come back to about 3 ft (1 m)', 'Next, the laptop will play fan noise while you speak. Starting by itself in 12 seconds.', 'wait');
        await waitChoice([{ id: 'go', label: 'Start', cls: 'primary' }, { id: 'skip', label: 'Skip' }], { autoMs: 12000 }).then(async (c) => {
          if (c !== 'skip') await runRound('noise', CORE.slice(0, 5), lang, { recognizer, where: 'Over the fan noise, about 3 ft away', noise: true });
        });
        // Chatter: normal talk must not trigger commands.
        for (const [key, text] of [['chatter-hinglish', CHATTER_HI], ['chatter-english', CHATTER_EN]]) {
          setStep(key);
          show('Read this aloud, normally', text, 'go');
          beep(990, 120);
          const a = rec.mark(); const t0 = performance.now();
          await countdown(32);
          await sleep(1500);
          const b = rec.mark();
          const res = recognizer.st.results.filter((r) => r.final && r.t >= t0 && r.t < performance.now());
          const triggers = []; for (const r of res) for (const al of r.alts.slice(0, 1)) { const c = parseCommand(al.t); if (c) triggers.push({ heard: al.t, intent: c.intent }); }
          let file = null; if (BRIDGE) { file = `fixtures/voice/${lang}/${key}.wav`; await saveBytes(file, wav16(rec.slice(a, b))); }
          V.chatter.push({ key, lang, finals: res.map((r) => r.alts[0].t), falseTriggers: triggers, file });
          logLine(`${key}: ${triggers.length} false command(s)`);
        }
        show('Optional: TV or YouTube in Hindi', 'Play any Hindi TV show or YouTube video near the laptop for 30 seconds, then press Start. Or press Skip.', 'wait');
        const c = await waitChoice([{ id: 'go', label: 'Start (30 s)', cls: 'primary' }, { id: 'skip', label: 'Skip' }], { autoMs: 25000 });
        if (c === 'go') {
          const t0 = performance.now(); show('Listening to the TV…', 'Do not speak.', 'go'); await countdown(30); await sleep(1500);
          const res = recognizer.st.results.filter((r) => r.final && r.t >= t0);
          const triggers = []; for (const r of res) { const cm = parseCommand(r.alts[0].t); if (cm) triggers.push({ heard: r.alts[0].t, intent: cm.intent }); }
          V.chatter.push({ key: 'tv', lang, finals: res.map((r) => r.alts[0].t), falseTriggers: triggers });
        }
      }
    } else {
      await runRound(`counter-${lang}`, CORE, lang, { recognizer, where: `Recognition language ${lang}. Stand about 3 ft (1 m) away` });
    }
    recognizer.stop();
    V.recognizerStats.push({ lang, restarts: recognizer.st.restarts, errors: recognizer.st.errors, results: recognizer.st.results.length, phrases: false, local: false });
    if (BRIDGE) await saveJson(`raw/voice/${lang}-results.json`, recognizer.st);
    await sleep(800);
  }

  // Newer Chrome features, when this browser has them: on-device recognition and biasing toward our words.
  const lang0 = langs[0];
  const f = V.features;
  if (!QUICK && f.phrasesProp && f.phraseClass) {
    show('One more round', 'Same words again, with the recognizer told to expect them. Starting by itself in 10 seconds.', 'wait');
    if (await waitChoice([{ id: 'go', label: 'Start', cls: 'primary' }, { id: 'skip', label: 'Skip' }], { autoMs: 10000 }) !== 'skip') {
      const r2 = makeRecognizer(lang0, { phrases: CMD.map(([s]) => s.replace('?', '')) });
      await sleep(1200);
      await runRound('biased', CORE, lang0, { recognizer: r2, where: 'About 3 ft (1 m) away', saveAudio: false });
      r2.stop(); V.recognizerStats.push({ lang: lang0, round: 'biased', phrasesSet: r2.st.phrasesSet, phrasesError: r2.st.phrasesError || null, errors: r2.st.errors });
    }
  }
  if (!QUICK && f.onDevice && f.onDevice[lang0] === 'available') {
    show('Last round: on-device recognition', 'Same words again, recognised on this computer instead of online. Starting by itself in 10 seconds.', 'wait');
    if (await waitChoice([{ id: 'go', label: 'Start', cls: 'primary' }, { id: 'skip', label: 'Skip' }], { autoMs: 10000 }) !== 'skip') {
      const rLocal = makeRecognizer(lang0, { local: true });
      await sleep(1200);
      await runRound('on-device', CORE, lang0, { recognizer: rLocal, where: 'About 3 ft (1 m) away', saveAudio: false });
      rLocal.stop(); V.recognizerStats.push({ lang: lang0, round: 'on-device', local: rLocal.st.local, localError: rLocal.st.localError || null, errors: rLocal.st.errors });
    }
  }
  rec.stop();
  const byRound = {};
  for (const p of V.prompts) { const k = `${p.round}|${p.lang}`; byRound[k] = byRound[k] || { pass: 0, total: 0 }; byRound[k].total++; if (p.pass) byRound[k].pass++; }
  V.summary = { byRound, falseTriggers: V.chatter.reduce((a, c) => a + c.falseTriggers.length, 0) };
  if (BRIDGE) await saveJson('fixtures/voice/manifest.json', V.prompts.filter((p) => p.file).map((p) => ({ file: p.file, say: p.say, expect: p.expect, lang: p.lang, round: p.round })));
  finish('Voice session finished.');
}

// ---------------------------------------------------------------- mode: voice-replay (automated)
async function modeVoiceReplay() {
  const lang = params.get('lang') || 'en-IN';
  const secs = Number(params.get('secs') || 60);
  setStep(`replaying for ${secs}s`);
  show('Replaying recorded speech', `Recognition language ${lang}. No one needs to do anything.`);
  const r = makeRecognizer(lang);
  await countdown(secs);
  r.stop();
  await sleep(1500);
  const base = r.st.audioStartT || (r.st.events.find((e) => e[0] === 'start') || [0, 0])[1];
  RES.replay = { lang, secs, audioStartT: r.st.audioStartT, errors: r.st.errors, restarts: r.st.restarts, results: r.st.results.filter((x) => x.final).map((x) => ({ t: Math.round(x.t - base), alts: x.alts })) };
  finish('Replay finished.');
}

// ---------------------------------------------------------------- mode: tts (guided)
const LINES = {
  step: 'Step 7. Line up the tadka. Keep the ghee, jeera, garlic and red chilli powder next to the stove, in the order they go in.',
  hinglish: 'Ghee garam karo. Chamakne lage toh bataiye.',
  hindi: 'घी गरम करो। चमकने लगे तो बताइए।',
  alert: 'Dal. Turn off the flame. Let the pressure drop by itself, about 10 minutes.',
};
function speakTimed(voice, text) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    const t0 = performance.now(); let t1 = null; let done = false;
    const end = (error) => { if (done) return; done = true; resolve({ startMs: t1 == null ? null : Math.round(t1 - t0), durMs: t1 == null ? null : Math.round(performance.now() - t1), error: error || null }); };
    u.onstart = () => { t1 = performance.now(); };
    u.onend = () => end(null);
    u.onerror = (e) => end(e.error || 'error');
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setTimeout(() => end('timeout'), 30000);
  });
}
async function modeTts() {
  setStep('voices');
  const voices = await getVoices();
  const app = { en: appPick(voices, 'en-IN'), hi: appPick(voices, 'hi-IN') };
  const T = RES.tts = { voices: voices.map(vInfo), appEnglish: vInfo(app.en), appHindi: vInfo(app.hi), plays: [], ratings: {} };
  const rank = (v) => (v === app.en || v === app.hi ? 0 : /^hi/i.test(v.lang) ? 1 : /^en-IN/i.test(v.lang) ? 2 : /^en-GB/i.test(v.lang) ? 3 : /^en-US/i.test(v.lang) ? 4 : 5) * 10 + (v.localService ? 1 : 0);
  const cands = voices.filter((v) => /^(en|hi)/i.test(v.lang)).sort((a, b) => rank(a) - rank(b)).slice(0, 40);
  show('Which voice should read the recipe?', 'Play each voice (laptop volume up). Rate how natural it sounds, 1 = robotic, 5 = like a person. The orange one is what the app uses now. Press Done when finished.');
  const panel = $('panel');
  const list = document.createElement('div'); list.className = 'list'; panel.appendChild(list);
  for (const v of cands) {
    const card = document.createElement('div');
    card.className = `voice${v === app.en || v === app.hi ? ' app' : ''}`;
    const isHi = /^hi/i.test(v.lang);
    card.innerHTML = `<div><span class="n"></span> ${v === app.en ? '<span class="tag">app English</span>' : ''}${v === app.hi ? '<span class="tag">app Hindi</span>' : ''}</div>
      <div class="m"></div>
      <div class="row"></div>
      <div class="row"><label>Natural? <select><option value="">rate</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
      <label><input type="radio" name="bestEn"> best for English</label><label><input type="radio" name="bestHi"> best for Hindi/Hinglish</label></div>`;
    card.querySelector('.n').textContent = v.name;
    card.querySelector('.m').textContent = `${v.lang} · ${v.localService ? 'on this computer' : 'online'}`;
    const row = card.querySelectorAll('.row')[0];
    const lines = isHi ? ['hindi', 'hinglish', 'alert'] : ['step', 'hinglish', 'alert'];
    for (const key of lines) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `▶ ${key}`;
      b.onclick = async () => { const r = await speakTimed(v, LINES[key]); T.plays.push({ voice: v.name, lang: v.lang, line: key, ...r }); logLine(`${v.name} / ${key}: start ${r.startMs} ms${r.error ? `, ${r.error}` : ''}`); };
      row.appendChild(b);
    }
    const sel = card.querySelector('select');
    sel.onchange = () => { T.ratings[v.name] = { ...(T.ratings[v.name] || {}), lang: v.lang, local: v.localService, score: Number(sel.value) || null }; };
    const [rEn, rHi] = card.querySelectorAll('input[type=radio]');
    rEn.onchange = () => { T.bestEnglish = vInfo(v); };
    rHi.onchange = () => { T.bestHindi = vInfo(v); };
    list.appendChild(card);
  }
  await waitChoice([{ id: 'done', label: 'Done', cls: 'good' }]);
  speechSynthesis.cancel();
  finish('Voice ratings saved.');
}

// ---------------------------------------------------------------- mode: convert (automated)
async function modeConvert() {
  const files = (params.get('files') || '').split('|').filter(Boolean);
  RES.converted = [];
  for (const name of files) {
    setStep(`decoding ${name}`);
    try {
      const r = await fetch(`/qa/fixtures/whistles/${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const decoded = await audio().decodeAudioData(await r.arrayBuffer());
      const rate = 48000; const len = Math.ceil(decoded.duration * rate);
      const off = new OfflineAudioContext(1, len, rate); const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
      const mono = (await off.startRendering()).getChannelData(0);
      const i16 = new Int16Array(mono.length); let peak = 0;
      for (let i = 0; i < mono.length; i++) { i16[i] = Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767))); peak = Math.max(peak, Math.abs(mono[i])); }
      const out = `fixtures/whistle-real/${name.replace(/\.[^.]+$/, '')}.wav`;
      await saveBytes(out, wav16(i16, rate));
      RES.converted.push({ name, out, secs: r3(decoded.duration), channels: decoded.numberOfChannels, peakDb: r3(20 * Math.log10(peak + 1e-9)) });
    } catch (e) { RES.converted.push({ name, error: errText(e) }); }
  }
  finish('Converted.');
}

// ---------------------------------------------------------------- start
const MODES = { ping: async () => finish('ok'), env: modeEnv, mpbench: modeMpBench, gesture: modeGesture, voice: modeVoice, 'voice-replay': modeVoiceReplay, tts: modeTts, convert: modeConvert };
$('kicker').textContent = `Cook-Along QA lab · ${MODE}${QUICK ? ' (quick)' : ''}`;
(MODES[MODE] || (() => { throw new Error(`unknown mode ${MODE}`); }))().catch(fail);
