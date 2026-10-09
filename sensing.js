// Camera (hand gestures, presence and distance) and microphone (noise level, cooker whistles).
// Everything runs in the browser; nothing is recorded or uploaded.

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const GESTURE_MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

export async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  await videoEl.play();
  return stream;
}

async function createWithFallback(Task, fileset, modelAssetPath, extra) {
  try {
    return await Task.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate: 'GPU' }, runningMode: 'VIDEO', ...extra });
  } catch (_) {
    return Task.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate: 'CPU' }, runningMode: 'VIDEO', ...extra });
  }
}

export async function loadVision() {
  const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  const gestures = await createWithFallback(vision.GestureRecognizer, fileset, GESTURE_MODEL, { numHands: 1 });
  let faces = null;
  try { faces = await createWithFallback(vision.FaceDetector, fileset, FACE_MODEL, {}); } catch (_) { faces = null; }
  return { gestures, faces };
}

// Calls onHand({name, score, x} | null) about 15 times a second and onFace(widthRatio) about twice a second.
export function runVisionLoop(videoEl, models, { onHand, onFace }) {
  let running = true;
  let lastHand = 0;
  let lastFace = 0;
  function frame() {
    if (!running) return;
    const now = performance.now();
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      if (now - lastHand > 66) {
        lastHand = now;
        try {
          const res = models.gestures.recognizeForVideo(videoEl, now);
          const top = res.gestures && res.gestures[0] && res.gestures[0][0];
          const lm = res.landmarks && res.landmarks[0];
          onHand(lm ? { name: top ? top.categoryName : 'None', score: top ? top.score : 0, x: lm[0].x } : null, now);
        } catch (_) { /* skip frame */ }
      }
      if (models.faces && now - lastFace > 450) {
        lastFace = now;
        try {
          const f = models.faces.detectForVideo(videoEl, now);
          const d = f.detections && f.detections[0];
          onFace(d ? d.boundingBox.width / videoEl.videoWidth : 0, now);
        } catch (_) { /* skip frame */ }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return () => { running = false; };
}

// Palm held for ARM_MS engages; then a sideways move within WINDOW_MS is a swipe.
// "Swipe left" means the hand moves to the cook's left, which is +x in the raw (unmirrored) camera image.
export class GestureInterpreter {
  constructor(handlers, opts = {}) {
    this.h = handlers;
    this.ARM_MS = opts.armMs || 500;
    this.WINDOW_MS = opts.windowMs || 3000;
    this.SWIPE_DX = opts.swipeDx || 0.12;
    this.state = 'idle';
    this.t0 = 0;
    this.lastSeen = 0;
    this.baseX = 0;
    this.cooldownUntil = 0;
    this.thumbSince = null;
  }

  reset() { this.state = 'idle'; this.h.onProgress(null); }

  feed(hand, now) {
    if (now < this.cooldownUntil) return;
    const palm = hand && hand.name === 'Open_Palm' && hand.score > 0.55;
    const thumb = hand && hand.name === 'Thumb_Up' && hand.score > 0.6;
    if (hand) this.lastSeen = now;

    if (this.state === 'idle') {
      if (thumb) {
        if (this.thumbSince == null) this.thumbSince = now;
        if (now - this.thumbSince > 400) { this.thumbSince = null; this.cooldownUntil = now + 1500; this.h.onThumb(); }
        return;
      }
      this.thumbSince = null;
      if (palm) { this.state = 'arming'; this.t0 = now; this.baseX = hand.x; this.h.onProgress(0); }
      return;
    }

    if (this.state === 'arming') {
      if (!palm && now - this.lastSeen > 200) { this.reset(); return; }
      if (!palm && hand && hand.name !== 'Open_Palm' && hand.name !== 'None') { this.reset(); return; }
      const p = Math.min(1, (now - this.t0) / this.ARM_MS);
      this.h.onProgress(p);
      if (hand) this.baseX = hand.x;
      if (p >= 1) { this.state = 'engaged'; this.t0 = now; this.h.onEngage(); }
      return;
    }

    if (this.state === 'engaged') {
      if (now - this.t0 > this.WINDOW_MS) { this.state = 'idle'; this.h.onCancel('timeout'); return; }
      if (!hand) {
        if (now - this.lastSeen > 450) { this.state = 'idle'; this.h.onCancel('dropped'); }
        return;
      }
      const dx = hand.x - this.baseX;
      if (dx > this.SWIPE_DX || dx < -this.SWIPE_DX) {
        this.state = 'idle';
        this.cooldownUntil = now + 900;
        this.h.onSwipe(dx > 0 ? 'left' : 'right');
      }
    }
  }
}

// Near when the face fills more of the frame; hysteresis stops flicker.
// The ratio depends on the camera's field of view, so thresholds come from a getter the demo panel can tune.
// With a typical 65 degree webcam, 0.30 is about 40 cm away; an ultra-wide tablet camera needs a lower value.
export class NearDetector {
  constructor(onChange, { thresholds = () => ({ enter: 0.3, exit: 0.22 }) } = {}) {
    this.onChange = onChange;
    this.thresholds = thresholds;
    this.near = false;
    this.since = null;
    this.lastFace = 0;
    this.present = false;
    this.onPresence = null;
  }

  feed(ratio, now) {
    const seen = ratio > 0;
    if (seen) this.lastFace = now;
    const present = now - this.lastFace < 8000;
    if (present !== this.present) { this.present = present; if (this.onPresence) this.onPresence(present, now); }
    const { enter, exit } = this.thresholds();
    const want = this.near ? ratio > exit : ratio > enter;
    if (want !== this.near) {
      if (this.since == null) this.since = now;
      if (now - this.since > (want ? 600 : 1200)) { this.near = want; this.since = null; this.onChange(want); }
    } else {
      this.since = null;
    }
  }
}

// Microphone: a slow noise-floor estimate (speech has gaps, a chimney doesn't) and a whistle detector.
export async function startMic({ onLevel, onLoudChange, onWhistle, getConfig }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  an.smoothingTimeConstant = 0.3;
  src.connect(an);
  const wave = new Float32Array(an.fftSize);
  const spec = new Float32Array(an.frequencyBinCount);
  const binHz = ctx.sampleRate / an.fftSize;
  const history = [];
  let loud = false;
  let loudSince = null;
  let whistleSince = null;
  let lastWhistle = -1e9;

  const timer = setInterval(() => {
    const cfg = getConfig();
    an.getFloatTimeDomainData(wave);
    let sum = 0;
    for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
    const db = 20 * Math.log10(Math.sqrt(sum / wave.length) + 1e-9);
    an.getFloatFrequencyData(spec);
    let band = 0;
    let total = 0;
    for (let i = 1; i < spec.length; i++) {
      const f = i * binHz;
      if (f < 120 || f > 8000) continue;
      const p = Math.pow(10, spec[i] / 10);
      total += p;
      if (f >= cfg.whistleLowHz && f <= cfg.whistleHighHz) band += p;
    }
    const ratio = total > 0 ? band / total : 0;

    history.push(db);
    if (history.length > 40) history.shift();
    const sorted = [...history].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.2)] ?? db;
    onLevel(db, floor, ratio);

    const now = performance.now();
    const wantLoud = loud ? floor > cfg.loudDb - 4 : floor > cfg.loudDb;
    if (wantLoud !== loud) {
      if (loudSince == null) loudSince = now;
      if (now - loudSince > (wantLoud ? 1500 : 2500)) { loud = wantLoud; loudSince = null; onLoudChange(loud); }
    } else {
      loudSince = null;
    }

    const whistleLike = db > cfg.whistleDb && ratio > cfg.whistleRatio;
    if (whistleLike) {
      if (whistleSince == null) whistleSince = now;
      if (now - whistleSince > 700 && now - lastWhistle > 6000) { lastWhistle = now; whistleSince = null; onWhistle(); }
    } else {
      whistleSince = null;
    }
  }, 50);

  return () => { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); ctx.close(); };
}

// Short two-note chime; each pot gets its own pair so you can tell them apart without looking.
let chimeCtx = null;
// Browsers start audio suspended until the page has been touched; after a reload the first touch wakes it.
export function unlockAudio() {
  try {
    if (!chimeCtx) chimeCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (chimeCtx.state === 'suspended') chimeCtx.resume();
  } catch (_) { /* audio unavailable */ }
}
export function chime(pot = 'dal', level = 0) {
  try {
    if (!chimeCtx) chimeCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (chimeCtx.state === 'suspended') chimeCtx.resume().catch(() => {});
    const notes = { dal: [440, 660], rice: [660, 880], kadai: [523, 784], soft: [587, 587] }[pot] || [440, 660];
    const gainMax = Math.min(0.9, 0.25 + level * 0.2);
    notes.forEach((freq, i) => {
      const o = chimeCtx.createOscillator();
      const g = chimeCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      const t = chimeCtx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gainMax, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(chimeCtx.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch (_) { /* audio unavailable */ }
}

export async function keepScreenOn() {
  try {
    if (!('wakeLock' in navigator)) return null;
    let lock = await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') { try { lock = await navigator.wakeLock.request('screen'); } catch (_) { /* ignore */ } }
    });
    return lock;
  } catch (_) {
    return null;
  }
}
