// Voice in (Web Speech API recognition) and voice out (Gemini TTS + speech synthesis fallback).
// Only a small vocabulary counts, so chatter and the TV can't move the recipe.

// Each intent lists English words, romanised Hinglish (as Indian-English recognition tends to spell it)
// and Devanagari (what Hindi recognition returns). The demo panel shows raw transcripts so new spellings can be added.
const COMMANDS = [
  { intent: 'undo', words: ['undo', 'galat', 'galt', 'galath', 'ghalat', 'wrong', 'गलत'] },
  { intent: 'ack', words: ['ho gaya', 'hogaya', 'ho gya', 'ho gayi', 'done', 'हो गया', 'हो गई', 'डन'] },
  { intent: 'where', words: ['where was i', 'kahan tha', 'kahan the', 'kaha tha', 'कहाँ था', 'कहां था'] },
  // Not plain "band karo": "gas band karo" (turn the gas off) is said in every kitchen, including by this app.
  { intent: 'stop', words: ['stop cooking', 'cooking band karo', 'cooking band', 'khatam karo', 'कुकिंग बंद करो', 'खत्म करो', 'ख़त्म करो'] },
  { intent: 'repeat', words: ['phir se', 'fir se', 'phirse', 'firse', 'dobara', 'repeat', 'again', 'फिर से', 'दोबारा', 'रिपीट'] },
  { intent: 'next', words: ['aage', 'aagey', 'agey', 'aagay', 'aa ge', 'aaage', 'agla', 'agle', 'aage badho', 'age', 'next', 'आगे', 'अगला', 'नेक्स्ट'] },
  { intent: 'back', words: ['peeche', 'piche', 'peechay', 'pichhe', 'peeche jao', 'peechhe', 'pichla', 'back', 'previous', 'पीछे', 'पिछला', 'बैक'] },
  { intent: 'pause', words: ['ruko', 'rukho', 'rukko', 'roko', 'ruk jao', 'wait', 'pause', 'रुको', 'रुक जाओ', 'वेट'] },
  { intent: 'resume', words: ['chalo', 'continue', 'resume', 'चलो'] },
  // Needs "seeti" or "whistle": a bare "ek aur" is usually about rotis.
  { intent: 'whistle', words: ['ek aur seeti', 'one more whistle', 'seeti', 'whistle', 'सीटी'] },
  { intent: 'help', words: ['madad', 'help', 'मदद', 'हेल्प'] },
  { intent: 'yes', words: ['haan', 'haa', 'han ji', 'haan ji', 'yes', 'हाँ', 'हां', 'हाँ जी'] },
  { intent: 'no', words: ['nahi', 'nahin', 'no', 'नहीं', 'नही'] },
];

// Mishearings that only count when the whole utterance is 3 words or fewer,
// because short words like "age" and "back" appear in normal talk.
const SHORT_ONLY_WORDS = new Set([
  'age', 'aagey', 'aagay', 'aa ge', 'agle', 'agla', 'aage badho',
  'piche', 'peechay', 'pichhe', 'peeche jao',
  'ho gya', 'hogaya', 'ho gayi',
  'fir se', 'phirse',
  'rukho', 'roko',
  'galt',
]);

// Core commands for phrase biasing and fast interim triggering.
export const CORE_COMMANDS = new Set([
  'aage', 'next', 'peeche', 'back', 'ruko', 'pause', 'chalo', 'ho gaya', 'done', 'phir se', 'repeat', 'galat', 'undo',
  'आगे', 'नेक्स्ट', 'पीछे', 'बैक', 'रुको', 'पॉज़', 'चलो', 'हो गया', 'डन', 'फिर से', 'दोबारा', 'रिपीट', 'गलत', 'अनडू',
]);

const BIASING_WORDS = [
  'aage', 'next', 'peeche', 'back', 'ruko', 'pause', 'chalo', 'ho gaya', 'done', 'phir se', 'repeat', 'galat', 'undo',
  'आगे', 'नेक्स्ट', 'पीछे', 'बैक', 'रुको', 'चलो', 'हो गया', 'डन', 'फिर से', 'दोबारा', 'रिपीट', 'गलत',
];

export function isCoreCommand(text) {
  const norm = String(text || '').toLowerCase().replace(/[.,!?।"“”']/g, ' ').replace(/\s+/g, ' ').trim();
  return CORE_COMMANDS.has(norm);
}

function normalise(text) {
  return ' ' + text.toLowerCase().replace(/[.,!?।"“”']/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

function hasPhrase(norm, phrase) {
  return norm.includes(' ' + phrase + ' ');
}

// Returns { intent, ...extras, heard } or null.
export function parseCommand(transcript) {
  const norm = normalise(transcript);
  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const howMuch = /(how much|kitna|kitni|कितना|कितनी)/.test(norm);
  if (howMuch) return { intent: 'howmuch', heard: transcript.trim() };
  // A timer needs the word "timer" too, so "5 minute mein aata hoon" or a spoken "about 10 min" doesn't set one.
  const timer = norm.match(/(\d+)\s*(minute|minutes|min|मिनट)/);
  if (timer && /(timer|टाइमर)/.test(norm)) return { intent: 'timer', minutes: Number(timer[1]), heard: transcript.trim() };
  const serves = norm.match(/(\d+)\s*(logon|logo|log|people|servings|लोगों)/);
  if (serves) return { intent: 'servings', servings: Number(serves[1]), heard: transcript.trim() };
  for (const c of COMMANDS) {
    for (const w of c.words) {
      if (SHORT_ONLY_WORDS.has(w) && wordCount > 3) continue;
      if (hasPhrase(norm, w)) return { intent: c.intent, word: w, heard: transcript.trim() };
    }
  }
  return null;
}

let phrasesLogged = false;

export function createRecognizer({ lang = 'en-IN', onAlternatives, onState }) {
  const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 3;

  try {
    if (typeof window !== 'undefined' && window.SpeechRecognitionPhrase && 'phrases' in rec) {
      rec.phrases = BIASING_WORDS.map((w) => new window.SpeechRecognitionPhrase(w, 5.0));
      if (!phrasesLogged) { phrasesLogged = true; console.log('phrases: on'); }
    } else {
      if (!phrasesLogged) { phrasesLogged = true; console.log('phrases: off'); }
    }
  } catch (_) {
    if (!phrasesLogged) { phrasesLogged = true; console.log('phrases: off'); }
  }

  let wanted = false;
  let restarting = false;
  let suppressedIntent = null;
  let suppressedUntil = 0;

  rec.onstart = () => onState('listening');
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const alts = [];
      const confidences = [];
      for (let j = 0; j < r.length; j++) {
        alts.push(r[j].transcript);
        confidences.push(typeof r[j].confidence === 'number' ? r[j].confidence : 1);
      }
      const primary = (alts[0] || '').trim();
      const words = primary.split(/\s+/).filter(Boolean);
      const conf = confidences[0] ?? 1;

      if (!r.isFinal) {
        if (words.length <= 3 && conf >= 0.6) {
          const cmd = parseCommand(primary);
          if (cmd && isCoreCommand(primary)) {
            suppressedIntent = cmd.intent;
            suppressedUntil = Date.now() + 2000;
            onAlternatives(alts, confidences);
          }
        }
        continue;
      }

      // Final result
      const cmd = parseCommand(primary);
      if (cmd && cmd.intent === suppressedIntent && Date.now() < suppressedUntil) {
        // Ignored: already fired on interim
        suppressedIntent = null;
        continue;
      }
      suppressedIntent = null;
      onAlternatives(alts, confidences);
    }
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
      wanted = false;
      onState('blocked', e.error);
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      onState('error', e.error);
    }
  };
  rec.onend = () => {
    if (wanted && !restarting) {
      restarting = true;
      setTimeout(() => { restarting = false; try { rec.start(); } catch (_) { /* already started */ } }, 250);
    } else if (!wanted) {
      onState('off');
    }
  };
  return {
    start() { wanted = true; try { rec.start(); } catch (_) { /* already started */ } },
    stop() { wanted = false; try { rec.stop(); } catch (_) { /* not started */ } },
    get wanted() { return wanted; },
    get rec() { return rec; },
  };
}

let speakingNow = false;
let startedAt = 0;
let endedAt = -1e9;
let current = 0;
let currentAudio = null;
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function markEnded() {
  if (speakingNow) endedAt = clock();
  speakingNow = false;
}

// Some browsers never fire "end" for an utterance, so after a grace period trust the engine's own flag.
export function isSpeaking() {
  if (speakingNow && currentAudio) {
    if (currentAudio.ended) markEnded();
    return speakingNow;
  }
  if (speakingNow && !currentAudio && clock() - startedAt > 1500 && typeof window !== 'undefined' && 'speechSynthesis' in window && !speechSynthesis.speaking && !speechSynthesis.pending) markEnded();
  return speakingNow;
}

// True while the app talks and for a moment after: recognition results can arrive a second after the audio.
export function spokeWithin(ms) {
  return isSpeaking() || clock() - endedAt < ms;
}

// Scores a speech voice for reading a recipe. Modern neural voices ("Natural", "Online") beat the
// old offline Windows ones; the right region beats a near one; Indian English is read best by
// en-IN, then British, whose vowels and stress are closer to it than American.
export function voiceScore(v, lang) {
  const l = (v.lang || '').replace('_', '-').toLowerCase();
  const want = lang.toLowerCase();
  if (!l.startsWith(want.slice(0, 2))) return -1;
  let s = 0;
  if (l === want) s += 100;
  else if (want.startsWith('en')) s += { 'en-gb': 70, 'en-au': 55, 'en-us': 50 }[l] || 40;
  else s += 40;
  const n = v.name || '';
  if (/natural|neural|online/i.test(n)) s += 60;
  else if (/google/i.test(n)) s += 25;
  else if (/^microsoft /i.test(n) && v.localService) s -= 20; // old offline desktop voices
  return s;
}

export function chooseVoice(voices, lang, preferred) {
  const pref = preferred && voices.find((v) => v.name === preferred && voiceScore(v, lang) >= 0);
  if (pref) return pref;
  let best = null; let bestScore = -1;
  for (const v of voices) { const s = voiceScore(v, lang); if (s > bestScore) { best = v; bestScore = s; } }
  return best;
}

function pickVoice(langPrefix) {
  const voices = typeof window !== 'undefined' && window.speechSynthesis ? speechSynthesis.getVoices() : [];
  let preferred = null;
  try { preferred = localStorage.getItem(`cookalong.voice.${langPrefix}`); } catch (_) { /* private mode */ }
  return chooseVoice(voices, langPrefix, preferred);
}

// ---------------------------------------------------------------- TTS cache and playback
const ttsUrlCache = new Map();
const CACHE_NAME = 'cookalong-tts-v2';

const inFlight = new Map();

// The download gets 30 s (a long step takes Gemini several seconds); speak() only waits 3.5 s for it
// before using the browser voice, and the download carries on so the line is natural next time.
function fetchTtsBlob(url) {
  if (!inFlight.has(url)) {
    const p = fetchTtsBlobOnce(url).finally(() => inFlight.delete(url));
    inFlight.set(url, p);
  }
  return inFlight.get(url);
}

async function fetchTtsBlobOnce(url) {
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const matched = await cache.match(url);
      if (matched) return await matched.blob();
    } catch (_) {}
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await caches.open(CACHE_NAME);
        cache.put(url, res.clone()).catch(() => {});
      } catch (_) {}
    }
    return await res.blob();
  } finally {
    clearTimeout(timer);
  }
}

export async function prefetchTts(text, { hindi } = {}) {
  if (!text || typeof window === 'undefined') return;
  const speakText = (hindi || text).trim();
  const lang = hindi ? 'hi-IN' : 'en-IN';
  const url = `/api/tts?t=${encodeURIComponent(speakText)}&l=${encodeURIComponent(lang)}`;
  if (ttsUrlCache.has(url)) return;
  try {
    const blob = await fetchTtsBlob(url);
    if (blob && !ttsUrlCache.has(url)) {
      const objectUrl = URL.createObjectURL(blob);
      ttsUrlCache.set(url, objectUrl);
    }
  } catch (_) {
    // Silent prefetch failure
  }
}

async function getTtsAudioUrl(text, { hindi } = {}) {
  const speakText = (hindi || text).trim();
  const lang = hindi ? 'hi-IN' : 'en-IN';
  const url = `/api/tts?t=${encodeURIComponent(speakText)}&l=${encodeURIComponent(lang)}`;
  if (ttsUrlCache.has(url)) return ttsUrlCache.get(url);
  const blob = await Promise.race([
    fetchTtsBlob(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('tts slow')), 3500)),
  ]);
  if (!ttsUrlCache.has(url)) ttsUrlCache.set(url, URL.createObjectURL(blob));
  return ttsUrlCache.get(url);
}

function speakWithSpeechSynthesis(text, { hindi, id } = {}) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) {
    markEnded();
    return Promise.resolve();
  }
  let utterText = text;
  let voice = pickVoice('en-IN');
  if (hindi) {
    const hv = pickVoice('hi-IN');
    if (hv) { voice = hv; utterText = hindi; }
  }
  const u = new SpeechSynthesisUtterance(utterText);
  if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = 'en-IN'; }
  u.rate = 0.95;
  return new Promise((resolve) => {
    const done = () => { if (id === current) markEnded(); resolve(); };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.cancel();
    speakingNow = true;
    startedAt = clock();
    speechSynthesis.speak(u);
  });
}

// Speaks English text with an Indian English voice, or Devanagari text with a Hindi voice when one exists.
// Uses Gemini TTS through /api/tts when online and naturalVoice is enabled; falls back silently to speechSynthesis.
export function speak(text, { hindi, naturalVoice } = {}) {
  if (!text) return Promise.resolve();
  stopSpeaking();
  const id = ++current;
  speakingNow = true;
  startedAt = clock();

  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const flagAllowed = naturalVoice !== false && (typeof window === 'undefined' || !window.__cookAlong?.S?.flags || window.__cookAlong.S.flags.naturalVoice !== false);
  const canUseNatural = online && flagAllowed && typeof Audio !== 'undefined';

  if (!canUseNatural) {
    return speakWithSpeechSynthesis(text, { hindi, id });
  }

  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => {
      if (settled) return;
      settled = true;
      if (currentAudio) {
        try { currentAudio.pause(); } catch (_) {}
        currentAudio = null;
      }
      if (id === current) {
        speakWithSpeechSynthesis(text, { hindi, id }).then(resolve);
      } else {
        markEnded();
        resolve();
      }
    };

    getTtsAudioUrl(text, { hindi }).then((audioUrl) => {
      if (id !== current) { resolve(); return; }
      try {
        const audio = new Audio(audioUrl);
        currentAudio = audio;
        startedAt = clock();

        audio.onended = () => {
          if (settled) return;
          settled = true;
          if (currentAudio === audio) currentAudio = null;
          if (id === current) markEnded();
          resolve();
        };
        audio.onerror = () => {
          fallback();
        };

        const playPromise = audio.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(() => fallback());
        }
      } catch (_) {
        fallback();
      }
    }).catch(() => {
      fallback();
    });
  });
}

export function stopSpeaking() {
  current++;
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (_) {}
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
  markEnded();
}

export const VOCABULARY = [
  ['aage, next', 'next step'],
  ['peeche, back', 'previous step'],
  ['phir se, repeat', 'read it again'],
  ['ruko / chalo', 'hold / carry on'],
  ['ho gaya, done', 'clear an alert, tick off a task'],
  ['galat, undo', 'undo the last command'],
  ['namak kitna?', 'how much of something'],
  ['5 minute ka timer', 'add a timer'],
  ['6 logon ke liye', 'rescale'],
  ['ek aur seeti', 'add a missed whistle'],
  ['kahan tha?', 'where was I'],
  ['cooking band karo', 'end Cook-Along (asks first)'],
];
