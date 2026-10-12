// WAV files for the fake microphone: synthetic cooker whistles, kitchen noise, and joining a person's
// recorded commands into one file with known timings. 16-bit mono PCM, which Chrome's fake capture reads.
import fs from 'node:fs';

export const RATE = 48000;

export function writeWav(file, samples, rate = RATE) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

// Reads 16-bit PCM WAV (mono or stereo, mixed to mono). Returns { samples: Float32Array, rate }.
export function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV file`);
  let off = 12; let fmt = null; let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4); const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(off + 8), channels: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.format !== 1 || fmt.bits !== 16) throw new Error(`${file}: only 16-bit PCM WAV is supported`);
  const frames = Math.floor(data.length / (2 * fmt.channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2) / 32768;
    out[i] = s / fmt.channels;
  }
  return { samples: out, rate: fmt.rate };
}

export function resample(samples, from, to = RATE) {
  if (from === to) return samples;
  const n = Math.floor(samples.length * to / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * from / to; const j = Math.floor(x); const f = x - j;
    out[i] = (samples[j] || 0) * (1 - f) + (samples[j + 1] || 0) * f;
  }
  return out;
}

const db = (d) => Math.pow(10, d / 20);
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };

// Room tone or a fan: white noise filtered toward brown, at a target RMS in dBFS.
export function noise(seconds, levelDb, { color = 'pink', seed = 7 } = {}) {
  const n = Math.round(seconds * RATE); const rnd = seeded(seed); const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd();
    if (color === 'white') out[i] = w;
    else if (color === 'brown') { last = (last + 0.02 * w) / 1.02; out[i] = last * 3.5; }
    else { b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913; out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; }
  }
  return normalise(out, levelDb);
}

export function normalise(x, levelDb) {
  let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const rms = Math.sqrt(s / Math.max(1, x.length)) || 1e-9; const g = db(levelDb) / rms;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

// A pressure-cooker whistle: a hissy tone with vibrato and harmonics, fading in and out.
export function whistle(seconds, levelDb, { hz = 3000, seed = 3 } = {}) {
  const n = Math.round(seconds * RATE); const rnd = seeded(seed); const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = hz * (1 + 0.015 * Math.sin(2 * Math.PI * 5.5 * t) + 0.01 * Math.sin(2 * Math.PI * 0.7 * t));
    ph += 2 * Math.PI * f / RATE;
    const env = Math.min(1, t / 0.25, (seconds - t) / 0.35);
    out[i] = env * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph) + 0.45 * rnd());
  }
  return normalise(out, levelDb);
}

// A steel ladle on a pan: short, bright, inharmonic. Should never count as a whistle.
export function clang(levelDb, seed = 11) {
  const n = Math.round(0.6 * RATE); const rnd = seeded(seed); const out = new Float32Array(n);
  const parts = [2310, 3170, 4420, 5630].map((f) => ({ f, a: 0.5 + 0.5 * Math.abs(rnd()) }));
  for (let i = 0; i < n; i++) {
    const t = i / RATE; let s = 0;
    for (const p of parts) s += p.a * Math.sin(2 * Math.PI * p.f * t);
    out[i] = s * Math.exp(-t * 9);
  }
  return normalise(out, levelDb);
}

// A mixer-grinder: a loud motor buzz with broadband grit.
export function grinder(seconds, levelDb, seed = 5) {
  const n = Math.round(seconds * RATE); const rnd = seeded(seed); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    out[i] = 0.6 * Math.sign(Math.sin(2 * Math.PI * 290 * t)) * 0.4 + 0.3 * Math.sin(2 * Math.PI * 580 * t) + 0.6 * rnd();
  }
  return normalise(out, levelDb);
}

export function mixInto(base, add, atSeconds) {
  const off = Math.round(atSeconds * RATE);
  for (let i = 0; i < add.length && off + i < base.length; i++) base[off + i] += add[i];
  return base;
}

export function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0); const out = new Float32Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const silence = (seconds) => new Float32Array(Math.round(seconds * RATE));

// The whistle test set: [name, samples, expectedWhistles, note]. Whistles are 9 s apart because the app
// ignores a second whistle within 6 s of the last.
export function whistleSet() {
  const set = [];
  const run = (name, { levels = [-20, -20, -20], hz = 3000, floorDb = -55, floorColor = 'pink', bed = null, note }) => {
    const total = 4 + levels.length * 9 + 3;
    const x = noise(total, floorDb, { color: floorColor });
    if (bed) mixInto(x, bed(total), 0);
    levels.forEach((lv, i) => mixInto(x, whistle(2.5, lv, { hz, seed: 3 + i }), 4 + i * 9));
    set.push([name, x, levels.length, note]);
  };
  run('whistle-3x-loud', { levels: [-12, -12, -12], note: '3 loud whistles in a quiet room' });
  run('whistle-3x-normal', { levels: [-22, -22, -22], note: '3 whistles at a typical level for a laptop mic 1.5 m away' });
  run('whistle-3x-quiet', { levels: [-32, -32, -32], note: '3 quiet whistles (far cooker or a weak mic)' });
  run('whistle-3x-veryquiet', { levels: [-40, -40, -40], note: '3 very quiet whistles; missing these is acceptable' });
  run('whistle-3x-low-1800hz', { levels: [-22, -22, -22], hz: 1800, note: 'a low-pitched cooker, below the app\'s 2 kHz band' });
  run('whistle-3x-high-5000hz', { levels: [-22, -22, -22], hz: 5000, note: 'a high-pitched cooker' });
  run('whistle-3x-with-fan', { levels: [-22, -22, -22], bed: (t) => noise(t, -30, { color: 'brown', seed: 21 }), note: 'whistles over an exhaust fan' });
  run('whistle-3x-with-loud-fan', { levels: [-22, -22, -22], bed: (t) => noise(t, -24, { color: 'pink', seed: 22 }), note: 'whistles over a loud chimney' });
  // Negatives: must count 0.
  { const x = noise(30, -26, { color: 'pink', seed: 31 }); set.push(['neg-loud-chimney', x, 0, '30 s of a loud chimney, no whistle']); }
  { const x = concat([noise(3, -55), grinder(10, -18), noise(3, -55)]); set.push(['neg-mixer-grinder', x, 0, 'a mixer grinder for 10 s']); }
  {
    const x = noise(20, -55);
    for (let i = 0; i < 12; i++) mixInto(x, clang(-14, 11 + i), 2 + i * 1.4);
    set.push(['neg-utensil-clangs', x, 0, '12 ladle-on-pan clangs']);
  }
  return set;
}
