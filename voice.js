// Voice in (Web Speech API recognition) and voice out (speech synthesis).
// Only a small vocabulary counts, so chatter and the TV can't move the recipe.

// Each intent lists English words, romanised Hinglish (as Indian-English recognition tends to spell it)
// and Devanagari (what Hindi recognition returns). The demo panel shows raw transcripts so new spellings can be added.
const COMMANDS = [
  { intent: 'undo', words: ['undo', 'galat', 'galath', 'ghalat', 'wrong', 'गलत'] },
  { intent: 'ack', words: ['ho gaya', 'hogaya', 'ho gya', 'ho gayi', 'done', 'हो गया', 'हो गई', 'डन'] },
  { intent: 'where', words: ['where was i', 'kahan tha', 'kahan the', 'kaha tha', 'कहाँ था', 'कहां था'] },
  // Not plain "band karo": "gas band karo" (turn the gas off) is said in every kitchen, including by this app.
  { intent: 'stop', words: ['stop cooking', 'cooking band karo', 'cooking band', 'khatam karo', 'कुकिंग बंद करो', 'खत्म करो', 'ख़त्म करो'] },
  { intent: 'repeat', words: ['phir se', 'fir se', 'phirse', 'firse', 'dobara', 'repeat', 'again', 'फिर से', 'दोबारा', 'रिपीट'] },
  { intent: 'next', words: ['aage', 'aagey', 'agey', 'aagay', 'aaage', 'agla', 'agle', 'next', 'आगे', 'अगला', 'नेक्स्ट'] },
  { intent: 'back', words: ['peeche', 'piche', 'pichhe', 'peechhe', 'pichla', 'back', 'previous', 'पीछे', 'पिछला', 'बैक'] },
  { intent: 'pause', words: ['ruko', 'rukko', 'roko', 'ruk jao', 'wait', 'pause', 'रुको', 'रुक जाओ', 'वेट'] },
  { intent: 'resume', words: ['chalo', 'continue', 'resume', 'चलो'] },
  // Needs "seeti" or "whistle": a bare "ek aur" is usually about rotis.
  { intent: 'whistle', words: ['ek aur seeti', 'one more whistle', 'seeti', 'whistle', 'सीटी'] },
  { intent: 'help', words: ['madad', 'help', 'मदद', 'हेल्प'] },
  { intent: 'yes', words: ['haan', 'haa', 'han ji', 'haan ji', 'yes', 'हाँ', 'हां', 'हाँ जी'] },
  { intent: 'no', words: ['nahi', 'nahin', 'no', 'नहीं', 'नही'] },
];

function normalise(text) {
  return ' ' + text.toLowerCase().replace(/[.,!?।"“”']/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

function hasPhrase(norm, phrase) {
  return norm.includes(' ' + phrase + ' ');
}

// Returns { intent, ...extras, heard } or null.
export function parseCommand(transcript) {
  const norm = normalise(transcript);
  const howMuch = /(how much|kitna|kitni|कितना|कितनी)/.test(norm);
  if (howMuch) return { intent: 'howmuch', heard: transcript.trim() };
  // A timer needs the word "timer" too, so "5 minute mein aata hoon" or a spoken "about 10 min" doesn't set one.
  const timer = norm.match(/(\d+)\s*(minute|minutes|min|मिनट)/);
  if (timer && /(timer|टाइमर)/.test(norm)) return { intent: 'timer', minutes: Number(timer[1]), heard: transcript.trim() };
  const serves = norm.match(/(\d+)\s*(logon|logo|log|people|servings|लोगों)/);
  if (serves) return { intent: 'servings', servings: Number(serves[1]), heard: transcript.trim() };
  for (const c of COMMANDS) {
    for (const w of c.words) if (hasPhrase(norm, w)) return { intent: c.intent, word: w, heard: transcript.trim() };
  }
  return null;
}

export function createRecognizer({ lang = 'en-IN', onAlternatives, onState }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = false;
  rec.maxAlternatives = 3;
  let wanted = false;
  let restarting = false;
  rec.onstart = () => onState('listening');
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r.isFinal) continue;
      const alts = [];
      for (let j = 0; j < r.length; j++) alts.push(r[j].transcript);
      onAlternatives(alts);
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
  };
}

let speakingNow = false;
let startedAt = 0;
let endedAt = -1e9;
let current = 0;
const clock = () => performance.now();

function markEnded() {
  if (speakingNow) endedAt = clock();
  speakingNow = false;
}

// Some browsers never fire "end" for an utterance, so after a grace period trust the engine's own flag.
export function isSpeaking() {
  if (speakingNow && clock() - startedAt > 1500 && 'speechSynthesis' in window && !speechSynthesis.speaking && !speechSynthesis.pending) markEnded();
  return speakingNow;
}

// True while the app talks and for a moment after: recognition results can arrive a second after the audio.
export function spokeWithin(ms) {
  return isSpeaking() || clock() - endedAt < ms;
}

function pickVoice(langPrefix) {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  return voices.find((v) => v.lang && v.lang.toLowerCase() === langPrefix.toLowerCase())
    || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix.slice(0, 2).toLowerCase()))
    || null;
}

// Speaks English text with an Indian English voice, or Devanagari text with a Hindi voice when one exists.
export function speak(text, { hindi } = {}) {
  if (!('speechSynthesis' in window) || !text) return Promise.resolve();
  let utterText = text;
  let voice = pickVoice('en-IN');
  if (hindi) {
    const hv = pickVoice('hi-IN');
    if (hv) { voice = hv; utterText = hindi; }
  }
  const u = new SpeechSynthesisUtterance(utterText);
  if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = 'en-IN'; }
  u.rate = 1;
  // Each utterance gets an id: cancelling the previous one fires its "end" late, and that must not
  // mark the new one as finished.
  const id = ++current;
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

export function stopSpeaking() {
  current++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
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
