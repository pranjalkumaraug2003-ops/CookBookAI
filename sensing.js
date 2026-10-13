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
  const gestures = await createWithFallback(vision.GestureRecognizer, fileset, GESTURE_MODEL, { numHands: 2 });
  let faces = null;
  try { faces = await createWithFallback(vision.FaceDetector, fileset, FACE_MODEL, {}); } catch (_) { faces = null; }
  return { gestures, faces };
}

// With two hands in view (or a false hand behind the cook), use the one making a gesture the app knows.
export function pickHand(res) {
  const hands = (res && res.landmarks) || [];
  let best = null;
  for (let i = 0; i < hands.length; i++) {
    const top = res.gestures && res.gestures[i] && res.gestures[i][0];
    const h = { name: top ? top.categoryName : 'None', score: top ? top.score : 0, x: hands[i][0].x };
    const known = h.name === 'Thumb_Up' || h.name === 'Thumb_Down';
    if (!best || (known && !best.known) || (known === best.known && h.score > best.hand.score)) best = { hand: h, known };
  }
  return best ? best.hand : null;
}

// Calls onHand({name, score, x} | null) about 15 times a second and onFace(widthRatio) about twice a second.
export function runVisionLoop(videoEl, models, { onHand, onFace }) {
  let running = true;
  let lastHand = 0;
  let lastFace = 0;
  let lastVT = -1;
  function frame() {
    if (!running) return;
    const now = performance.now();
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      // A webcam often delivers 10 to 15 fps: skip a frame the model has already seen.
      if (now - lastHand > 66 && videoEl.currentTime !== lastVT) {
        lastHand = now;
        lastVT = videoEl.currentTime;
        try {
          const res = models.gestures.recognizeForVideo(videoEl, now);
          onHand(pickHand(res), now);
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

// Thumbs up and thumbs down hold gestures.
// Poses count when name is Thumb_Up or Thumb_Down with score > 0.6.
// Hold duration defaults to 3000 ms (or opts.holdMs getter).
export class GestureInterpreter {
  constructor(handlers, opts = {}) {
    this.h = handlers || {};
    this.opts = opts;
    this.holdingDir = null;
    this.t0 = 0;
    this.lastPoseTime = 0;
    this.cooldownUntil = 0;
    this.unreleased = null;
    this.lastSeenUp = -10000;
    this.lastSeenDown = -10000;
  }

  reset() {
    this.holdingDir = null;
    this.t0 = 0;
    this.lastPoseTime = 0;
    if (this.h.onProgress) this.h.onProgress(null);
  }

  feed(hand, now) {
    const pose = (hand && (hand.name === 'Thumb_Up' || hand.name === 'Thumb_Down') && hand.score > 0.6)
      ? (hand.name === 'Thumb_Up' ? 'up' : 'down')
      : null;

    if (pose === 'up') this.lastSeenUp = now;
    if (pose === 'down') this.lastSeenDown = now;

    if (this.unreleased === 'up' && now - this.lastSeenUp >= 400) {
      this.unreleased = null;
    }
    if (this.unreleased === 'down' && now - this.lastSeenDown >= 400) {
      this.unreleased = null;
    }

    const holdMs = typeof this.opts.holdMs === 'function' ? this.opts.holdMs() : (this.opts.holdMs || 3000);

    if (!this.holdingDir) {
      if (pose && this.unreleased !== pose) {
        this.holdingDir = pose;
        this.t0 = now;
        this.lastPoseTime = now;
        if (this.h.onProgress) this.h.onProgress({ dir: pose, p: 0 });
      }
      return;
    }

    if (pose === this.holdingDir) {
      this.lastPoseTime = now;
      const p = Math.min(1, (now - this.t0) / holdMs);
      if (p >= 1) {
        if (now >= this.cooldownUntil) {
          const firedDir = this.holdingDir;
          this.holdingDir = null;
          this.t0 = 0;
          this.lastPoseTime = 0;
          this.cooldownUntil = now + 1500;
          this.unreleased = firedDir;
          if (this.h.onProgress) this.h.onProgress(null);
          if (this.h.onThumb) this.h.onThumb(firedDir);
        } else {
          if (this.h.onProgress) this.h.onProgress({ dir: this.holdingDir, p: 1 });
        }
      } else {
        if (this.h.onProgress) this.h.onProgress({ dir: this.holdingDir, p });
      }
      return;
    }

    if (pose) {
      // Switching to opposite pose restarts hold for new pose
      const newDir = pose;
      this.holdingDir = null;
      this.t0 = 0;
      this.lastPoseTime = 0;
      if (this.unreleased !== newDir) {
        this.holdingDir = newDir;
        this.t0 = now;
        this.lastPoseTime = now;
        if (this.h.onProgress) this.h.onProgress({ dir: newDir, p: 0 });
      } else {
        if (this.h.onProgress) this.h.onProgress(null);
      }
      return;
    }

    // Gap or weaker frame
    if (now - this.lastPoseTime > 300) {
      this.reset();
    } else {
      const p = Math.min(1, (now - this.t0) / holdMs);
      if (p >= 1) {
        if (now >= this.cooldownUntil) {
          const firedDir = this.holdingDir;
          this.holdingDir = null;
          this.t0 = 0;
          this.lastPoseTime = 0;
          this.cooldownUntil = now + 1500;
          this.unreleased = firedDir;
          if (this.h.onProgress) this.h.onProgress(null);
          if (this.h.onThumb) this.h.onThumb(firedDir);
        } else {
          if (this.h.onProgress) this.h.onProgress({ dir: this.holdingDir, p: 1 });
        }
      } else {
        if (this.h.onProgress) this.h.onProgress({ dir: this.holdingDir, p });
      }
    }
  }
}

// Near when the face fills more of the frame; hysteresis stops flicker.
// The ratio depends on the camera's field of view, so thresholds come from a getter the demo panel can tune.
// On a laptop webcam (measured), the face is about 0.17 of the frame at 2 ft, so 0.22 is roughly arm's reach; a wide tablet camera needs a lower value.
export class NearDetector {
  constructor(onChange, { thresholds = () => ({ enter: 0.22, exit: 0.16 }) } = {}) {
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
