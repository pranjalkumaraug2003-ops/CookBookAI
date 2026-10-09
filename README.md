# Cook-Along Mode

A hands-free cooking mode for a tablet propped 3 to 5 ft from the stove, built for cooks whose hands are covered in flour, oil or water. It started as the prototype for the Nielsen Product Design Intern assignment (Brief 2, "Messy Hands") and is now a working web app:

* **Any recipe.** Paste a YouTube link, a recipe website or a chatbot answer. The app drafts the pots, timers and doneness cues, and you check them on a review screen before cooking. The dal tadka + jeera rice recipe is built in.
* **YouTube mode.** The recipe video plays inside Cook-Along one step at a time and pauses itself at the end of each step until you say "aage".
* **Never lose your place.** A reload, a crash or a dead battery comes back on the same step with the timers still right.
* **Works offline** after the first visit, and installs as an app.
* Everything from the prototype: Hinglish voice commands, palm-and-swipe gestures, elbow holds, cooker whistle counting, timers in fixed colour lanes, rescaling, the tadka called out beat by beat.

No build step. Plain HTML, CSS and JavaScript modules in the browser; two small Node functions on the server.

---

## Run it

### Locally

Needs Node 20 or newer.

```bash
node dev-server.js
```

Open **http://localhost:8000** in **Google Chrome** and allow the microphone and camera. Browsers only allow those on `https://` pages or on `localhost`.

Recipe import works locally too. Without a key it reads pasted text and recipe websites with simple rules. To use the AI model (needed for YouTube):

```bash
GEMINI_API_KEY=your-key node dev-server.js        # macOS, Linux, Git Bash
$env:GEMINI_API_KEY="your-key"; node dev-server.js  # Windows PowerShell
```

### Deploy (Vercel, free)

1. Push this folder to a GitHub repository.
2. On vercel.com: **Add New → Project → Import** the repository. No build settings are needed (Framework: Other).
3. **Settings → Environment Variables**: add `GEMINI_API_KEY` (create one at aistudio.google.com → Get API key). Optional variables are listed in `.env.example`.
4. Redeploy. Open the `https://….vercel.app` link on the tablet in Chrome, hold it in landscape, and use **Install app** from Chrome's menu.

The static part also runs on GitHub Pages, but GitHub Pages can't run the import server. There, pasted text is still read on the device with simple rules; links need the server.

---

## How to use it

1. **Pick a recipe** from the library, or **Add a recipe**: paste a link or the recipe text, check the draft on the review screen, save.
2. On the recipe page, set **Cooking for** (taps are fine here; your hands are still clean) and press **Start Cook-Along**.
3. From then on nothing needs a clean finger:

| You want to | Voice | Gesture | Touch (elbow or knuckle) |
|---|---|---|---|
| Next step | "aage" / "next" | open palm for ½ s, then swipe left | hold Next for ½ s (near mode) |
| Previous step | "peeche" / "back" | open palm, then swipe right | hold Back for ½ s (near mode) |
| Clear an alert | "ho gaya" / "done" | thumbs up | hold anywhere on the alert |
| Tick off a chopping task | "ho gaya", or name it: "garlic ho gaya" | thumbs up | hold the row for ½ s |
| Undo the last command | "galat" / "undo" | | |
| Hear the step again (or replay its video) | "phir se" / "repeat" | | |
| Pause / play the video | "ruko" / "chalo" | | |
| Quantity of something | "namak kitna?" | | |
| Add a timer | "5 minute ka timer" | | |
| Cook for more or fewer people | "6 logon ke liye", then "haan" | | |
| Add a missed whistle | "ek aur seeti" | | |
| Catch up after a break | "kahan tha?" | (automatic when you come back) | |
| See all commands | "madad" / "help" | | |
| End early | "cooking band karo", then "haan" | | |

Quick taps are ignored on purpose: wet fingers and splashes should never move the recipe. Every command is echoed at the bottom ("Heard 'aage': moved to step 7") with a way to undo it.

### YouTube mode, in detail

* Each step has a start time in the video (the model finds them; you can correct them on the review screen).
* The video plays that step's part, then **pauses and waits**. "aage" moves on and plays the next part; "phir se" replays this one.
* **While the video plays, only "ruko" is listened for.** The person in the video could say "aage" or "ho gaya", and the app must not obey them. Gestures and elbow holds still work.
* **Whistles heard while the video plays are not counted**, because the video may have its own cooker. Say "ek aur seeti" if you miss one.
* An alert (a pot needs you) pauses the video.

---

## How a recipe is imported

`POST /api/import` with a link or text. The order of trust:

1. **The page's own recipe data.** Most recipe sites publish a machine-readable recipe (schema.org Recipe in JSON-LD, written by plugins such as WP Recipe Maker so that Google can show recipe cards). It is read directly.
2. **A language model** (Google Gemini, answering in a fixed JSON schema) maps the steps to pots, timers, doneness cues and steps that can't be paused. For YouTube it watches the video and returns a start time for each step.
3. **Repairs on the server** (`api/_lib/convert.js`): unknown pots, amounts that name no ingredient, timers without a time, out-of-order video times. Each repair becomes a note on the review screen.
4. **Simple rules** (`parse-text.js`) when there is no model or it fails, and on the device when there is no server or no network.
5. **The cook's review.** Nothing is cooked from a draft until it is saved.

Safety on the server: links are checked so the server never fetches its own network (no localhost, private or link-local addresses, on every redirect); pages are capped at 2.5 MB and 10 s; requests are rate-limited per address; the API key stays on the server. Text from a web page can try to instruct the model, so the model's answer is only ever data in the schema, it is checked again, and the cook reviews it.

---

## What is real and what is simplified

**Real, working in the browser**

* Voice commands in English and Hinglish (Web Speech API, `en-IN` or `hi-IN`), with a small fixed vocabulary so chatter and the TV can't move the recipe.
* Read-aloud of every step (speech synthesis). Spoken lines are checked so the app never says one of its own command words.
* Hand gestures: open palm then swipe, and thumbs up (MediaPipe Gesture Recognizer, on the device).
* Near and away detection from face size and presence (MediaPipe Face Detector, on the device).
* Noise level and cooker whistle detection (Web Audio, on the device).
* Timers, collision warnings, the cooker safety wait, rescaling with a preview, undo, the screen staying awake.
* Recipe import, review, library, notes per recipe; resume after reload; offline after the first visit.
* YouTube mode through YouTube's official IFrame Player API.

**Simplified or not built**

* The whistle detector is a simple loudness-and-pitch rule. It can be fooled by other high-pitched sounds and by a neighbour's cooker. Tune it on your cooker (below).
* The cooker cooling time is a fixed estimate (10 min), not measured.
* Imported recipes don't get the beat-by-beat tadka; a step that can't be paused is announced one step early instead.
* Recipes and notes are kept in this browser only. There are no accounts and no sync between devices.
* The layout is designed for a tablet in landscape (1180 × 820). On a phone it works but the text is smaller than the distance rules allow.
* A model can misread a recipe. That is why nothing starts without the review screen.

**Privacy.** Nothing from the kitchen is recorded or saved. The camera, whistle and noise sensing run entirely on the device. Voice recognition uses the browser's speech service, which in Chrome means the audio of your commands is sent to Google for recognition. Recipe links and text you import are sent to this app's server and to Google Gemini to draft the recipe.

---

## Demo controls (for testing and recording)

Press **D** (or "Demo · D", bottom left). Keyboard shortcuts:

| Key | Does |
|---|---|
| → or Space | next (or clear an alert) |
| ← | back |
| W | a cooker whistle |
| L | toggle "too loud" |
| N | toggle near mode |
| P | palm, then a swipe left |
| T | thumbs up |
| A | press once to "walk away", again to "come back" |
| V | play or pause the video |
| H | the help sheet |
| U | undo |
| Enter | clear an alert or close a sheet |

The panel also has timer speed, jump to step, voice language, a live mic level, a live camera preview and an event log that shows every transcript the app heard.

### Tuning to your kitchen

The sensing thresholds start as guesses. Tune them in the panel with your own cooker, tablet and kitchen; **the values are saved on the device**.

1. **Whistle**: wait for a real whistle and watch "Mic level" and "whistle band" in Status. Set **Whistle above** a few dB below the level during a whistle and above the level while talking.
2. **Too loud**: exhaust fan on high, watch the noise floor, set **Too loud above** just under it.
3. **Near**: read "face" in Status at the stove and up close; set **Near when face width is over** between the two.

---

## Files

```
index.html          the page: a fixed 1180 × 820 stage, scaled to fit the screen
app.js              cooking engine: state, timers, commands, rendering, resume, YouTube mode, demo panel
library.js          library, add-a-recipe and review screens
recipe.js           the recipe format, validation, quantities and scaling; the built-in dal tadka
parse-text.js       rule-based recipe reader (used offline and when there is no model)
store.js            what is kept on the device: recipes, notes, settings, the live session
voice.js            command vocabulary and parser, speech recognition, read-aloud
sensing.js          camera (gestures, near, presence) and microphone (noise, whistles)
video.js            YouTube IFrame Player wrapper
icons.js            inline icons
styles.css          all styling; type sizes follow the distance rules in the case study
sw.js, manifest.webmanifest, icons/   offline cache and install
api/import.js       POST /api/import
api/health.js       GET /api/health (is the AI model configured?)
api/_lib/           page reading and SSRF guard, Gemini client, draft repairs
dev-server.js       local server that also runs the /api functions
tests/              unit checks and two browser suites
fonts/              Atkinson Hyperlegible Next and Mono (SIL Open Font License)
```

### Design rules the code follows

* **Type sized by distance.** Anything read from the stove (5 ft) is at least 53 px on an 11-inch tablet; anything read from the counter (3 ft) at least 32 px. Step headlines are 64 px (56 px for long ones and in YouTube mode), timer digits 76 px, alert headlines 120 px.
* **One colour per pot, in a fixed slot**: yellow, blue, orange, in the order the pots are first used.
* **The app never says a command word out loud**, and ignores what it hears for 1.2 s after speaking.
* **Commands that can't be taken back ask first**: opening the cooker early, rescaling, ending.
* **The screen is drawn in layers** that are only rewritten when their own content changes, so a ticking timer never redraws the step card, and the YouTube player lives outside them so it never restarts.

### Tests

```bash
npm install
npx playwright install chromium
npm test
```

`tests/unit.js` (39 checks: the rule-based reader, validation, page reading, the SSRF guard, draft repairs) and two browser suites run against the local server with a stand-in for Gemini: `tests/flow.cjs` (61 checks on the cooking engine with the dal tadka) and `tests/product.cjs` (40 checks: import and review, cooking an imported recipe, resume after reload, offline, the on-device fallback, YouTube mode). Screenshots of every state land in `tests/shots/`.

---

## Credits

* Fonts: Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono, Braille Institute, SIL Open Font License 1.1.
* Hand and face models: MediaPipe Tasks Vision (Google), loaded from jsDelivr and Google Cloud Storage at run time and cached for offline use.
* Recipe drafting: Google Gemini API. Video playback: YouTube IFrame Player API.
