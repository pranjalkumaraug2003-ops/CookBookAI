// Makes the shipped voice files: every line in audio/lines.json (the tour and the built-in dal tadka, recorded
// by scripts/record-lines.cjs) is fetched once from the live voice server and saved as audio/v-<hash>.wav,
// with audio/voice.json mapping "lang|text" to its file. Run by the "Voice files" GitHub workflow.
//   VOICE_BASE=https://cookbookai-eight.vercel.app node scripts/fetch-voice.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'audio');
const base = (process.env.VOICE_BASE || 'https://cookbookai-eight.vercel.app').replace(/\/$/, '');
const EXTRA = [{ t: 'Exit this cook?', l: 'en-IN' }, { t: 'End Cook-Along now?', l: 'en-IN' }];
const lines = [...JSON.parse(fs.readFileSync(path.join(dir, 'lines.json'), 'utf8')), ...EXTRA];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fnv = (str) => { let h = 0x811c9dc5; for (const b of Buffer.from(str, 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

// 24 kHz from the model becomes 16 kHz here: plenty for speech, a third smaller.
function to16k(wav) {
  const rate = wav.readUInt32LE(24);
  const data = wav.subarray(44);
  const n = data.length >> 1;
  const src = new Int16Array(n); for (let i = 0; i < n; i++) src[i] = data.readInt16LE(i * 2);
  const out = Math.floor(n * 16000 / rate);
  const pcm = Buffer.alloc(out * 2);
  for (let i = 0; i < out; i++) {
    const x = i * rate / 16000; const k = Math.floor(x); const f = x - k;
    const v = (src[k] || 0) * (1 - f) + (src[Math.min(k + 1, n - 1)] || 0) * f;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const manifestPath = path.join(dir, 'voice.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
let made = 0; let failed = 0;
for (const { t, l } of lines) {
  const key = `${l}|${t}`;
  const file = `v-${fnv(key)}.wav`;
  if (manifest[key] && fs.existsSync(path.join(dir, manifest[key]))) continue;
  let ok = false;
  for (let attempt = 0; attempt < 6 && !ok; attempt++) {
    try {
      const res = await fetch(`${base}/api/tts?t=${encodeURIComponent(t)}&l=${encodeURIComponent(l)}`, { signal: AbortSignal.timeout(70000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && buf.subarray(0, 4).toString() === 'RIFF' && buf.length > 2000) {
        fs.writeFileSync(path.join(dir, file), to16k(buf));
        manifest[key] = file; ok = true; made++;
        console.log(`ok   ${file}  ${t.slice(0, 60)}`);
      } else {
        console.log(`wait ${res.status} (${attempt + 1}/6)  ${t.slice(0, 40)}`);
        await sleep(25000);
      }
    } catch (e) {
      console.log(`err  ${e.message} (${attempt + 1}/6)`);
      await sleep(25000);
    }
  }
  if (!ok) failed++;
  await sleep(4000); // stay under the free tier's per-minute limit
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`${made} new files, ${failed} failed, ${Object.keys(manifest).length} in voice.json`);
if (failed) process.exitCode = 1;
