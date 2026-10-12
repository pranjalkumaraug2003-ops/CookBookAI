# Cook-Along Mode: full QA screening (instructions for the testing agent)

You are testing **Cook-Along Mode**, a hands-free cooking web app (voice commands, hand gestures, cooker-whistle counting, read-aloud). Live: https://cookbookai-eight.vercel.app/ · Code: https://github.com/pranjalkumaraug2003-ops/CookBookAI

The owner (Pranjal) reports: **gestures don't work, and the speech sounds outdated and robotic.** Your job is to measure exactly what is wrong, on this real computer with its real camera, microphone and speakers, and to hand back a results package. **A different engineer will read your results and fix the code. You do not fix anything.**

## Rules

1. **Do not edit any app file** (anything outside `qa/`). Do not commit or push. Do not open pull requests.
2. If a `qa/` script crashes because of an obvious bug in the script itself, you may make the smallest fix. Log the fix (file, line, why) in `qa/out/AGENT_NOTES.md`.
3. Recordings of Pranjal's face and voice (`qa/out/fixtures/`) stay on this computer. Never upload them, and never paste them anywhere.
4. Never print, read or ask for API keys.
5. Pranjal is with you for the guided parts. Before each guided part, tell him in one or two plain sentences what he will do and where to stand. Then start it, and wait until it finishes. The browser window guides him with large text and beeps.
6. When a step fails, retry once. If it fails again, record the exact error and move on. Do not stop the whole run.
7. Write down what you **observe**, with numbers, timestamps and exact error text. Don't write guesses about causes as if they were facts. Label any hypothesis as "hypothesis".

## 0. Setup (Windows, PowerShell)

```powershell
cd $HOME\Desktop\CookBookAI
git clone https://github.com/pranjalkumaraug2003-ops/CookBookAI.git qa-run
cd qa-run
npm install
npx playwright install chromium
npm install --no-save axe-core
node qa/run.mjs ping
```

`ping` must end with "phase ping finished". Google Chrome must be installed; Edge usually is. Every phase writes to `qa/out/` and appends to `qa/out/run.log`. During long phases, `qa/out/status.json` shows progress.

## 1. Automatic checks (no help needed, about 10 minutes)

```powershell
npm test                                   # existing 183 checks; save the last 40 lines to qa/out/suite.txt
node qa/run.mjs env                        # Chrome: camera, mic, GPU, voices, speech recognition, gesture model
node qa/run.mjs env --browser msedge       # same in Edge (Edge has different, often more natural, voices)
node qa/run.mjs mpbench                    # gesture model speed and errors: pinned 0.10.14 vs latest, GPU vs CPU
```

During `mpbench`, ask Pranjal to sit in front of the camera and show an open hand now and then.

## 2. Guided sessions with Pranjal (about 30 minutes)

Do them in this order. Each opens a Chrome window and finishes by itself, except `tts` (he presses Done) and `app` (you close the window).

| # | Command | What Pranjal does | Time |
|---|---|---|---|
| 1 | `node qa/run.mjs tts` | Plays each read-aloud voice and rates it 1 to 5, picks the best English and best Hindi voice, presses Done | 5 min |
| 2 | `node qa/run.mjs tts --browser msedge` | Same, in Edge | 5 min |
| 3 | `node qa/run.mjs gesture` | Palm, swipe left/right and thumbs up at 2 ft, 3 ft and 5 ft, plus normal cooking movements. The laptop must sit where it would in a kitchen. | 8 min |
| 4 | `node qa/run.mjs gesture --mp latest --quick` | Short repeat with the newest gesture model, to compare | 3 min |
| 5 | `node qa/run.mjs voice` | Says each command (Hinglish and English) at 3 ft and 5 ft, with fan noise, then reads two paragraphs aloud (these must NOT trigger commands) | 10 min |
| 6 | `node qa/run.mjs app` | The real app (see below) | 10 min |

### The `app` session (you run this one)

The real app opens on step 1 of the dal tadka recipe, with voice, gestures, whistle listening and read-aloud all on. Keep a timestamped log in `qa/out/AGENT_NOTES.md` while you guide Pranjal through each check below. For each check, note: what he did, what the app did (step number, the message at the top, what it said aloud), how long it took, and pass/fail.

1. Wait until the pills at the top show voice and gestures as ready. Note how many seconds that took and what the pills say.
2. From 3 ft, say "aage" (next), then "peeche" (back), then "phir se" (repeat). Wait for the app to finish speaking before each one.
3. Say "aage" **while** the app is still reading a step aloud. Note whether it was ignored.
4. Open palm (hold until the ring fills), then swipe left; then do the same and swipe right. Try each 3 times. Count how many worked.
5. From 5 ft, repeat 2 and 4.
6. Say "aage" until step 3 ("Pressure cook the dal"). Then run `node qa/make-whistles.mjs` and play these through the speakers, one at a time: `qa/out/whistles/whistle-3x-normal.wav`, `whistle-3x-quiet.wav`, `neg-loud-chimney.wav`, `neg-utensil-clangs.wav`. To play a file, use `(New-Object Media.SoundPlayer "$PWD\qa\out\whistles\whistle-3x-normal.wav").PlaySync()`. Note the whistle count the app shows before and after each file; the difference is what it detected. Compare with `qa/out/whistles/expected.json`. After 3 whistles the app raises an alert: that is check 7, and after it, reload the page to reset the count. If Pranjal has real cooker recordings in `qa/fixtures/whistles/`, play those too.
7. When the "Turn off the flame" alert appears: clear it once with "ho gaya" and once with a thumbs up (reload and play the whistles again to get it back).
8. Say "namak kitna" and "5 minute ka timer". Note what happens.
9. Listen to 3 or 4 read-aloud steps. Ask Pranjal to rate the voice (1 to 5) and note his words.
10. Close the window. This saves `qa/out/app-chrome.json`, which holds the app's own log and state every second.

## 3. Your own screening of the live site (about 15 minutes, no help needed)

Use your browser on https://cookbookai-eight.vercel.app/ and look at it like a first-time user and like a reviewer. For every problem, add a row to `qa/out/agent-issues.md` with these columns: severity (blocker/major/minor), area, steps, expected, actual, and a screenshot path under `qa/out/screens/`.

- **The tour:** open `?tour=1` and go through all 15 stops. Does each stop make sense, and is anything broken or cut off?
- **Recipes:** add a recipe with "Try a sample", then with a recipe website link, then with a YouTube cooking link. Note the time each takes and any errors. Edit something on the review screen and save.
- **Sizes:** check every screen at 1180×820, 1366×768, 820×1180 and 390×844. Look for overflow, clipped or overlapping text, and text too small to read from 3 to 5 ft.
- **Console:** record console errors and failed network requests on each screen.
- **Accessibility:** run axe-core on the library, add, setup, recipe and cooking screens. List violations by impact.
- **Pages:** check that `/privacy.html` loads and its links work.
- **Offline:** switch to offline in DevTools after the first load and reload. Does the app still open?

## 4. Write up and hand back

1. In `qa/out/AGENT_NOTES.md`, add a **Findings** section at the top, ordered by severity. For each finding give the evidence, as numbers and file names. Cover at least:
   - **Gestures:**
     - From `gesture-chrome.json`: which delegate loaded (GPU or CPU) and any GPU error.
     - Per distance: the percentage of frames with a hand detected, the gesture categories seen, the error count and `staleFramePct`.
     - Pass rate for each gesture and distance.
     - For swipes, `afterEngage.maxLeft`/`maxRight` (the app needs ±0.12) and the frames lost during the swipe.
     - For thumbs up, `longestThumbMs` (the app needs about 400 ms unbroken).
     - Any action that fired during "cook normally".
     - Pinned vs latest model (`mpbench-*.json`, and the quick latest run).
   - **Read-aloud:**
     - The voice the app uses now (`env-*.json` `appVoice`) and how Pranjal rated it.
     - The best-rated voices in Chrome and Edge.
     - Whether Hinglish lines read by an English voice sound wrong.
   - **Voice commands:**
     - Accuracy per round (counter, stove, noise) and per language.
     - Commands that failed, with what was heard instead.
     - Latency.
     - False triggers from the paragraphs and the TV.
     - Recognition errors and restarts.
     - On-device and phrase-biasing support (`voice.features`).
   - **Whistles:** detected vs expected for each file, and false positives.
   - **Everything else:** the `npm test` result, live-site issues, accessibility, layout.
2. Run `node qa/run.mjs collect`. It builds `qa/out/qa-results.zip` (JSON, logs, notes and screenshots, with no face or voice recordings).
3. Tell Pranjal: where the zip is, the top 5 findings in one line each, and anything you could not test and why.
