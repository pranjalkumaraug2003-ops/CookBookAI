// GET /api/tts?t=<text>&l=en-IN|hi-IN&v=<voice>
// Converts text to spoken audio via Gemini's audio speech model.
// Returns audio/wav with immutable caching so repeat plays hit Vercel's edge cache.
import { limited } from './import.js';
import { pcmToWav } from './_lib/wav.js';
import { log } from './_lib/log.js';

export const config = { maxDuration: 60 };

let discovered = null;
// Uses GEMINI_TTS_MODEL when set; otherwise asks the API once which speech models this key can use.
async function ttsModel(key) {
  if (process.env.GEMINI_TTS_MODEL) return process.env.GEMINI_TTS_MODEL;
  if (discovered) return discovered;
  try {
    const r = await fetch(`${BASE()}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    const names = (j.models || [])
      .filter((m) => /tts/i.test(m.name) && (m.supportedGenerationMethods || ['generateContent']).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
    discovered = names.find((n) => /flash/i.test(n)) || names[0] || null;
  } catch (_) { /* fall through */ }
  return discovered || 'gemini-2.5-flash-preview-tts';
}

const BASE = () => process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('allow', 'GET');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Use GET.', code: 'method' });
  }

  const t0 = Date.now();
  const url = new URL(req.url, 'http://localhost');
  const text = (url.searchParams.get('t') || '').trim();
  const lang = (url.searchParams.get('l') || 'en-IN').trim();
  const voice = (url.searchParams.get('v') || process.env.TTS_VOICE || 'Orus').trim();

  if (!text || text.length > 400) {
    return sendJson(res, 400, { error: 'Text must be between 1 and 400 characters.', code: 'invalid_text' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (limited(ip, { bucket: 'tts', limit: Number(process.env.TTS_LIMIT || 120) })) {
    log('tts', { status: 429, code: 'rate_limited', length: text.length }, 'warn');
    return sendJson(res, 429, { error: 'Too many requests. Try again shortly.', code: 'rate_limited' });
  }

  // A separate key (its own Google project, so its own free quota) can serve speech alone.
  const key = process.env.GEMINI_TTS_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    log('tts', { status: 501, code: 'no_key', length: text.length }, 'error');
    return sendJson(res, 501, { error: 'No model key on the server.', code: 'no_key' });
  }

  const model = await ttsModel(key);
  const prompt = 'Say this warmly and naturally, like an Indian home cook talking to a friend in the kitchen, at a relaxed pace. Pronounce Hindi words the Indian way: ' + text;

  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: prompt }],
    }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
    },
  };

  try {
    // The free tier allows only a few speech calls a minute: wait and retry when Gemini says it is busy.
    let resp;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      const targetUrl = `${BASE()}/models/${encodeURIComponent(model)}:generateContent`;
      resp = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));
      if ((resp.status !== 429 && resp.status !== 503) || attempt === 2 || Date.now() - t0 > 30000) break;
      // Out of today's quota: waiting will not help, so fail fast and let the app use its backup voice.
      const why = await resp.clone().text().catch(() => '');
      if (/per ?day|PerDay/i.test(why)) { log('tts', { status: 429, code: 'daily_quota', length: text.length }, 'warn'); break; }
      log('tts', { status: resp.status, code: 'retry', attempt, length: text.length }, 'warn');
      await new Promise((r) => setTimeout(r, 7000 * (attempt + 1)));
    }

    if (!resp.ok) {
      log('tts', { status: resp.status, code: 'model_failed', length: text.length, voice, model, ms: Date.now() - t0 }, 'error');
      return sendJson(res, resp.status >= 500 ? 502 : resp.status, { error: 'Speech synthesis failed.', code: 'tts_failed' });
    }

    const data = await resp.json();
    const cand = data && data.candidates && data.candidates[0];
    const part = cand && cand.content && cand.content.parts && cand.content.parts[0];
    const pcmBase64 = part && part.inlineData && part.inlineData.data;

    if (!pcmBase64) {
      log('tts', { status: 502, code: 'empty_audio', length: text.length, voice, model, ms: Date.now() - t0 }, 'error');
      return sendJson(res, 502, { error: 'Model returned no audio.', code: 'empty_audio' });
    }

    const rate = Number((/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1]) || 24000;
    const wavBuffer = pcmToWav(pcmBase64, { sampleRate: rate });
    log('tts', { status: 200, length: text.length, voice, model, lang, bytes: wavBuffer.length, ms: Date.now() - t0 });

    res.statusCode = 200;
    res.setHeader('content-type', 'audio/wav');
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    // Keep every generated line on Vercel's CDN, so each line costs quota once, ever.
    res.setHeader('vercel-cdn-cache-control', 'max-age=31536000');
    res.end(wavBuffer);
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    log('tts', { status: isTimeout ? 504 : 500, code: isTimeout ? 'timeout' : 'server', length: text.length, ms: Date.now() - t0 }, 'error');
    return sendJson(res, isTimeout ? 504 : 500, { error: 'The speech model could not be reached.', code: isTimeout ? 'timeout' : 'server' });
  }
}
