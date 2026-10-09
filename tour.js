// The reviewer tour: a two-minute walk through a real cook of the built-in dal tadka, for someone looking at
// the app at a desk rather than standing at a stove. Each stop sets the app up from scratch and then
// simulates the input a cook would give (a spoken word, a whistle, a thumbs up). Simulated input is always
// labelled as simulated, in the tour bar and in the app's own echo line. Nothing is saved while touring.
import { escapeHtml as esc } from './recipe.js';

export function createTour(api) {
  const { S, DAL } = api;
  const bar = document.getElementById('tourBar');
  let i = -1;
  let timers = [];
  let savedFlags = null;

  const later = (ms, fn) => { timers.push(setTimeout(() => { if (i >= 0) { fn(); api.render(); } }, ms)); };
  const clearLater = () => { timers.forEach(clearTimeout); timers = []; };
  const say = (word, extra = {}) => api.handleIntent({ intent: extra.intent, word, heard: extra.heard || word, ...extra }, { kind: 'voice', word, heard: extra.heard || word, sim: true });

  // A fresh cook on step `step` (0-based), with every timer the earlier steps would have started.
  function cookAt(step, { near = false } = {}) {
    api.openRecipe(DAL);
    S.servings = 4;
    api.startCooking();
    S.voiceState = 'demo';
    S.camState = 'demo';
    S.nearOverride = near;
    S.loudOverride = null;
    S.engaged = false;
    for (let k = 1; k <= step; k++) {
      api.goToStep(k, { force: true, quiet: true });
      // Past the cooker step, the dal has whistled and is cooling, as it would be in a real cook.
      if (k === 3) { for (let w = 0; w < 3; w++) api.addWhistle('tour'); api.thumbsUp(); }
    }
    S.history = [];
    S.echo = null;
    S.notice = null;
  }

  const STOPS = [
    {
      title: 'The recipe page, used with clean hands',
      body: 'Pick how many people you are cooking for and press Start. From here on, nothing needs a clean finger.',
      run() { api.openRecipe(DAL); S.servings = 4; },
    },
    {
      title: 'Read from the stove, 5 ft away',
      body: 'One step at a time, in type sized for the distance (64 px headlines). On the right, one fixed slot and colour per pot: dal yellow, rice blue, kadai orange.',
      run() { cookAt(0); },
    },
    {
      title: 'Voice, in Hinglish',
      body: '“aage” moves on, “peeche” goes back. Every command is echoed with what was heard, and “galat” undoes it.',
      sim: 'Simulated: the cook says “aage” twice',
      run() { cookAt(0); later(700, () => say('aage', { intent: 'next' })); later(2200, () => say('aage', { intent: 'next' })); },
    },
    {
      title: 'Whistles count themselves',
      body: 'The microphone listens for the cooker. Each whistle fills a dot and is announced, so nobody has to count in their head.',
      sim: 'Simulated: two cooker whistles',
      run() { cookAt(2); later(900, () => api.addWhistle('tour')); later(2600, () => api.addWhistle('tour')); },
    },
    {
      title: 'When a pot needs you, the whole screen says so',
      body: 'After the third whistle: flame off, in the pot\'s own colour, readable from across the kitchen. It chimes again every 15 s, a little louder, until someone responds.',
      sim: 'Simulated: the third whistle',
      run() { cookAt(2); api.addWhistle('tour'); api.addWhistle('tour'); S.notice = null; later(900, () => api.addWhistle('tour')); },
    },
    {
      title: 'Clear it without touching anything',
      body: 'Say “ho gaya”, show a thumbs up, or hold anywhere with an elbow. The dal now runs a cooling timer: the cooker isn\'t safe to open yet.',
      sim: 'Simulated: a thumbs up to the camera',
      run() { cookAt(2); for (let k = 0; k < 3; k++) api.addWhistle('tour'); S.notice = null; later(1200, () => api.thumbsUp()); },
    },
    {
      title: 'Hands in the dough? Come closer',
      body: 'When the camera sees you near, big targets appear for an elbow or a knuckle. Only a half-second hold counts, so splashes and bumps never do. Try it: hold “Next” with the mouse.',
      sim: 'Simulated: “garlic ho gaya”',
      run() { cookAt(3, { near: true }); later(1000, () => say('ho gaya', { intent: 'ack', heard: 'garlic ho gaya' })); },
    },
    {
      title: 'Too loud for voice? Use a palm',
      body: 'With the exhaust fan on high, the kitchen is louder than speech, so voice pauses itself and says so. A palm held for half a second, then a swipe, still works.',
      sim: 'Simulated: fan on high, then a palm',
      run() { cookAt(5); S.loudOverride = true; later(1500, () => { S.engaged = true; S.engagedAt = Date.now(); }); },
    },
    {
      title: 'Warn before, not during',
      body: 'A tadka can\'t be paused, so it is lined up one step early, while the cooker cools, in the order it will go in.',
      run() { cookAt(7); },
    },
    {
      title: 'Guests arrived',
      body: '“6 logon ke liye” shows what changes from this step on and what is already cooking. Nothing changes until the cook says “haan”.',
      sim: 'Simulated: “6 logon ke liye”',
      run() { cookAt(7); later(600, () => say('6 logon ke liye', { intent: 'servings', servings: 6 })); },
    },
    {
      title: 'The app won\'t let you open a hot cooker',
      body: 'The mash step waits until the cooling timer says it is safe. “haan” overrides it if the cook knows better.',
      sim: 'Simulated: “aage” while the cooker is still cooling',
      run() {
        cookAt(2);
        for (let k = 0; k < 3; k++) api.addWhistle('tour');
        api.thumbsUp();
        for (let k = 3; k <= 7; k++) api.goToStep(k, { force: true, quiet: true });
        S.echo = null; S.notice = null;
        later(800, () => say('aage', { intent: 'next' }));
      },
    },
    {
      title: 'The tadka, beat by beat',
      body: 'Called out in Hinglish with a countdown for each beat, and “flame off” comes before the chilli powder.',
      sim: 'Simulated: “ho gaya” when the ghee is hot',
      run() { cookAt(9); later(1800, () => say('ho gaya', { intent: 'ack' })); },
    },
    {
      title: 'Back after the doorbell',
      body: 'When nobody has been in front of the camera for a minute, coming back shows what happened meanwhile.',
      sim: 'Simulated: away for 3 minutes',
      run() { cookAt(5); S.events.push({ t: Date.now() - 100000, pot: 'rice', text: 'Rice has soaked' }, { t: Date.now() - 40000, pot: 'kadai', text: 'Onions: needs you' }); S.awaySince = Date.now() - 3 * 60000; api.showRecap(); },
    },
    {
      title: 'Done, with a note for next time',
      body: 'Say what you would change; it is saved with the recipe and shown before the next cook.',
      sim: 'Simulated: “agli baar namak thoda kam”',
      run() { cookAt(10); api.finish(); later(1200, () => { S.notes = ['Agli baar namak thoda kam (tour)']; }); },
    },
    {
      title: 'Now try your own recipe',
      body: 'Paste a YouTube link, a recipe website or a chatbot answer, check the draft, and cook it. Or start the dal tadka with your real microphone and camera.',
      end: true,
      run() { S.screen = 'library'; },
    },
  ];

  function show() {
    const st = STOPS[i];
    bar.innerHTML = `<div class="tour-in">
      <div class="tour-txt">
        <div class="tour-k">Tour · ${i + 1} of ${STOPS.length}${st.sim ? ` <span class="tour-sim">${esc(st.sim)}</span>` : ''}</div>
        <div class="tour-t">${esc(st.title)}</div>
        <div class="tour-b">${esc(st.body)}</div>
      </div>
      <div class="tour-btns">
        ${st.end
    ? '<button type="button" class="tour-btn" data-tour="add">Add a recipe</button><button type="button" class="tour-btn" data-tour="real">Cook with mic and camera</button><button type="button" class="tour-btn primary-t" data-tour="exit">Finish</button>'
    : `${i > 0 ? '<button type="button" class="tour-btn" data-tour="back">Back</button>' : ''}<button type="button" class="tour-btn primary-t" data-tour="next">Next</button><button type="button" class="tour-btn ghost-t" data-tour="exit" aria-label="Exit the tour">Exit</button>`}
      </div>
    </div>`;
  }

  function go(n) {
    clearLater();
    i = Math.max(0, Math.min(STOPS.length - 1, n));
    api.stopSpeaking();
    STOPS[i].run();
    show();
    api.render();
    api.fit();
  }

  function start() {
    if (i >= 0) return;
    savedFlags = { ...S.flags };
    // No permission prompts during the tour: voice, gestures and whistles are simulated (see startSensors).
    S.demo = true;
    document.body.classList.add('touring');
    go(0);
  }

  function stop(then) {
    clearLater();
    i = -1;
    S.demo = false;
    if (savedFlags) Object.assign(S.flags, savedFlags);
    Object.assign(S, { nearOverride: null, loudOverride: null, engaged: false, sheet: null, alert: null, notice: null, echo: null, voiceState: 'off', camState: 'off' });
    document.body.classList.remove('touring');
    bar.innerHTML = '';
    api.store.clearSession();
    api.stopSpeaking();
    if (then === 'add') S.screen = 'add';
    else if (then === 'real') { api.openRecipe(DAL); }
    else S.screen = 'library';
    api.render();
    api.fit();
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour]');
    if (!b) return;
    const a = b.dataset.tour;
    if (a === 'next') go(i + 1);
    else if (a === 'back') go(i - 1);
    else stop(a);
  });

  return { start, stop, active: () => i >= 0, index: () => i, count: STOPS.length, go };
}
