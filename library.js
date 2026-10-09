// The clean-hands screens: the recipe library, adding a recipe (link, pasted text or written by hand),
// and the review screen where the cook checks pots, timers and steps before anything starts.
// Taps are fine here: these screens are used before cooking, not with messy hands.
import { LANES, VESSELS, VESSEL_NAMES, normalizeRecipe, fill, escapeHtml as esc, slug } from './recipe.js';
import { parseRecipeText } from './parse-text.js';
import { I, vesselIcon } from './icons.js';
import { fmtTime, parseTime, youtubeId } from './video.js';

const API = (window.COOKALONG_API || '').replace(/\/$/, '');

const SAMPLE = `Here's a simple Rajma Chawal recipe for 4 people.

Ingredients
- 1 cup rajma, soaked overnight
- 3 cups water
- 2 tbsp oil
- 1 tsp cumin seeds
- 2 onions, finely chopped
- 3 tomatoes, pureed
- 1 tsp red chilli powder
- Salt to taste
- 1.5 cups basmati rice

Instructions
1. Pressure cook the rajma with 3 cups water and salt for 6 whistles.
2. Rinse the rice and soak it for 20 minutes.
3. Heat oil in a kadai and add cumin seeds. Let them crackle.
4. Add the onions and sauté until golden, 8 to 10 minutes.
5. Add the tomatoes and chilli powder. Cook until oil separates.
6. Once the pressure releases, open the cooker and add the rajma to the kadai. Simmer for 15 minutes.
7. Cook the rice in a pot with 3 cups water for 12 minutes on low flame.
8. Serve the rajma over the rice.`;

export function libraryScreens({ S, render, openRecipe, store, log }) {
  let savedCode = '';
  try { savedCode = localStorage.getItem('cookalong.importCode') || ''; } catch (_) { /* storage unavailable */ }
  const ui = { code: savedCode, importText: '', status: 'idle', message: '', started: 0, confirmDel: null, warnings: [], method: '', health: null, draft: null, mode: 'new', expanded: null };
  S.ui = ui;

  // Whether imports will use AI on this server; asked once, quietly.
  function checkHealth() {
    if (ui.health) return;
    ui.health = { checking: true };
    // The answer only changes two lines, so only they are updated: re-rendering would steal focus from the text box.
    const apply = (j) => {
      ui.health = j || { ok: false };
      const how = document.getElementById('howAi');
      const priv = document.getElementById('privAi');
      if (how) how.textContent = howText();
      if (priv) priv.textContent = privText();
      const code = document.getElementById('codeSlot');
      if (code && ui.health.needsCode && !code.firstChild) render();
    };
    fetch(`${API}/api/health`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then(apply).catch(() => apply(null));
  }

  // ---------------------------------------------------------------- library
  function sourceBadge(r) {
    const k = r.source.kind;
    if (k === 'youtube') return `<div class="badge yt">${I.video(16)}YouTube</div>`;
    if (k === 'blog') return `<div class="badge">${I.link(16)}${esc(r.source.site || 'Web')}</div>`;
    if (k === 'text') return `<div class="badge">${I.doc(16)}Pasted</div>`;
    return `<div class="badge">${I.book(16)}Built in</div>`;
  }

  function libraryView() {
    const recipes = store.listRecipes();
    const sess = store.loadSession();
    const cards = recipes.map((r) => {
      const live = sess && sess.recipeId === r.id && sess.screen === 'cook';
      const pots = r.pots.map((p, i) => `<div class="potpill"><i style="background:${LANES[i].color}"></i>${esc(p.name)}</div>`).join('');
      const del = r.source.kind === 'builtin' ? '' : ui.confirmDel === r.id
        ? `<button type="button" class="mini danger" data-tap="del:${r.id}">${I.trash(16, '#fff')}Delete for good</button>`
        : `<button type="button" class="mini" data-tap="askdel:${r.id}" aria-label="Delete ${esc(r.title)}">${I.trash(16)}</button>`;
      return `<div class="rcard">
        <button type="button" class="rcard-open" data-tap="open:${r.id}">
          <div class="rtop">${sourceBadge(r)}${live ? `<div class="badge live">In progress · step ${sess.step + 1}</div>` : ''}</div>
          <div class="rtitle">${esc(r.title)}</div>
          <div class="rmeta">${r.steps.length} steps · serves ${r.baseServings}${r.source.kind === 'builtin' ? '' : ` · added ${new Date(r.savedAt || Date.now()).toLocaleDateString([], { day: 'numeric', month: 'short' })}`}</div>
          <div class="pots">${pots}</div>
        </button>
        ${del ? `<div class="rcard-actions">${del}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="lib">
      <div class="lib-head">
        <div><div class="lib-k">Cook-Along</div><h1>Your recipes</h1></div>
        <div class="lib-btns"><button type="button" class="ghost" data-tap="tour">${I.play(18)}<span>Take the 2-minute tour</span></button><button type="button" class="primary" data-tap="add">${I.plus(24, '#fff')}<span>Add a recipe</span></button></div>
      </div>
      <div class="lib-sub">Pick one to cook hands-free. Add your own from a YouTube video, a recipe website or a chatbot answer.${S.online ? '' : ` <b>${I.wifiOff(16)} Offline:</b> saved recipes still work.`}</div>
      <div class="rgrid">${cards}<button type="button" class="rcard addcard-tile" data-tap="add">${I.plus(30)}<div class="rtitle">Add a recipe</div><div class="rmeta">Paste a YouTube link, a recipe website or a chatbot answer. You check the pots and timers before cooking.</div></button></div>
    </div>`;
  }

  // ---------------------------------------------------------------- add
  const howText = () => (ui.health && !ui.health.checking
    ? (ui.health.ai ? 'An AI model (Google Gemini) drafts the pots, timers and cues. You check everything before cooking.' : 'This server has no AI model set up, so simple rules read the recipe. Links to videos need the model.')
    : 'The steps are mapped to pots, timers and doneness cues.');
  const privText = () => `The link or text you paste is sent to this app's server${ui.health && ui.health.ai ? ' and to Google Gemini' : ''} to read the recipe. Nothing from your kitchen (camera, mic, voice) is sent with it.`;
  const STAGES = [[0, 'Reading the link'], [3000, 'Finding the recipe'], [8000, 'Mapping steps to pots and timers'], [20000, 'Watching the video for step times'], [60000, 'Still watching: long videos take up to two minutes'], [120000, 'Almost there']];

  function addView() {
    checkHealth();
    const busy = ui.status === 'loading';
    const isUrl = /^https?:\/\/\S+$/i.test(ui.importText.trim());
    const isYt = isUrl && youtubeId(ui.importText.trim());
    const elapsed = Date.now() - ui.started;
    const stage = STAGES.filter(([t]) => elapsed >= t && (isYt || (t !== 20000 && t !== 60000))).pop();
    return `<div class="add">
      <div class="lib-head">
        <div><button type="button" class="crumb-btn" data-tap="library">${I.left(18, '#171B20', 2.4)}<span>Recipes</span></button><h1>Add a recipe</h1></div>
      </div>
      <div class="addgrid">
        <div class="card addcard">
          <label class="lbl" for="importText">Paste a link (YouTube or a recipe website), or the recipe itself</label>
          <textarea id="importText" data-ui="importText" placeholder="https://www.youtube.com/watch?v=…&#10;or https://a-recipe-blog.com/dal-tadka&#10;or paste the ingredients and steps" ${busy ? 'disabled' : ''}>${esc(ui.importText)}</textarea>
          <div class="addrow">
            <button type="button" class="primary" data-tap="import" ${busy || !ui.importText.trim() ? 'disabled' : ''}>${busy ? '<span class="spin"></span>' : I.right(22, '#fff')}<span>${busy ? esc(stage ? stage[1] : 'Working') + '…' : isYt ? 'Read the video' : isUrl ? 'Read the page' : 'Read the recipe'}</span></button>
            ${busy ? '<button type="button" class="ghost" data-tap="cancel-import">Cancel</button>' : '<button type="button" class="ghost" data-tap="sample">Try a sample</button>'}
            <button type="button" class="ghost" data-tap="scratch" ${busy ? 'disabled' : ''}>Write one by hand</button>
          </div>
          <div id="codeSlot">${ui.health && ui.health.needsCode ? `<label class="codeline">Access code for this server <input type="password" data-ui="code" value="${esc(ui.code)}" autocomplete="off"></label>` : ''}</div>
          ${ui.status === 'error' ? `<div class="err">${I.warn(20, '#AA3606')}<div>${esc(ui.message)}</div></div>` : ''}
          ${busy && isYt ? '<div class="hintline">Videos take one to two minutes: the model watches the whole video to find where each step starts.</div>' : ''}
        </div>
        <div class="addside">
          <div class="how"><div class="k">What happens</div>
            <ol>
              <li>If the page has a recipe card, it is read directly.</li>
              <li id="howAi">${esc(howText())}</li>
              <li>You review it: fix a pot, a timer or a step, then save.</li>
            </ol>
          </div>
          <div class="how"><div class="k">Privacy</div><div id="privAi">${esc(privText())}</div><a class="plink" href="privacy.html">Full privacy details</a></div>
          ${S.online ? '' : `<div class="err">${I.wifiOff(20, '#AA3606')}<div>You're offline. Pasted text can still be read with simple rules; links need a connection.</div></div>`}
        </div>
      </div>
    </div>`;
  }

  let importCtl = null;
  async function runImport() {
    const input = ui.importText.trim();
    if (!input) return;
    ui.status = 'loading';
    ui.started = Date.now();
    ui.message = '';
    const ticker = setInterval(() => { if (S.screen === 'add' && ui.status === 'loading') render(); else clearInterval(ticker); }, 1000);
    render();
    importCtl = new AbortController();
    const isUrl = /^https?:\/\/\S+$/i.test(input);
    // A video takes the model one to two minutes to watch; text takes seconds.
    const timeout = setTimeout(() => importCtl.abort(), isUrl && youtubeId(input) ? 175000 : 90000);
    try {
      const res = await fetch(`${API}/api/import`, { method: 'POST', headers: { 'content-type': 'application/json', ...(ui.code ? { 'x-import-code': ui.code } : {}) }, body: JSON.stringify({ input }), signal: importCtl.signal });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : null;
      if (!res.ok || !data || !data.recipe) {
        // A static host (no server) answers 404 or HTML: read pasted text on the device instead.
        if (!isUrl && (!data || res.status === 404 || res.status === 405)) return localImport(input, 'The recipe server is not available here, so simple rules on this device made the draft.');
        throw new Error((data && data.error) || `The server answered ${res.status}.`);
      }
      openReview(data.recipe, data.warnings || [], data.method || '', 'new');
    } catch (e) {
      if (e.name === 'AbortError') { ui.status = ui.cancelled ? 'idle' : 'error'; ui.message = ui.cancelled ? '' : 'That took too long. Try again, or paste the recipe text.'; ui.cancelled = false; }
      else if (!isUrl && (e instanceof TypeError || !navigator.onLine)) { localImport(input, 'Offline, so simple rules on this device made the draft.'); return; }
      else { ui.status = 'error'; ui.message = e.message || 'Something went wrong.'; }
      log(`import failed: ${ui.message}`);
      render();
    } finally {
      clearTimeout(timeout);
      clearInterval(ticker);
      importCtl = null;
    }
  }

  function localImport(text, why) {
    const warnings = [why, 'Check pots and timers carefully.'];
    const recipe = normalizeRecipe({ ...parseRecipeText(text), id: `r-${Date.now().toString(36)}` }, { warnings });
    openReview(recipe, warnings, 'rules on this device', 'new');
  }

  function blankRecipe() {
    return normalizeRecipe({
      id: `r-${Date.now().toString(36)}`, title: '', source: { kind: 'text' }, baseServings: 2,
      pots: [{ id: 'pot1', name: 'Main pot', vessel: 'pot' }],
      ingredients: {}, groups: [],
      steps: [{ place: 'Counter', pot: null, headline: 'First step', detail: '' }],
    });
  }

  // ---------------------------------------------------------------- review
  function openReview(recipe, warnings, method, mode) {
    ui.draft = JSON.parse(JSON.stringify(recipe));
    ui.warnings = warnings;
    ui.method = method;
    ui.mode = mode;
    ui.status = 'idle';
    ui.error = '';
    S.screen = 'review';
    render();
  }

  const timerOf = (st) => (st.onEnter && st.onEnter[0]) || null;
  const timerKind = (st) => { const t = timerOf(st); if (!t) return 'none'; return t.type === 'cooling' ? 'countdown' : t.type; };

  function stepEditor(st, i) {
    const d = ui.draft;
    const k = timerKind(st);
    const t = timerOf(st);
    const potOpts = `<option value="">No pot (counter)</option>${d.pots.map((p) => `<option value="${esc(p.id)}" ${st.pot === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
    const laneIdx = d.pots.findIndex((p) => p.id === st.pot);
    const color = laneIdx >= 0 ? LANES[laneIdx].color : 'var(--ink3)';
    const whistled = d.steps.slice(0, i).some((s) => s.pot === st.pot && (s.onEnter || []).some((x) => x.type === 'whistle'));
    const preview = fill(d, st.headline, d.baseServings);
    const isYt = d.source.kind === 'youtube';
    const open = ui.expanded === i;
    return `<div class="sedit${open ? ' open' : ''}" style="--lane:${color}">
      <div class="shead">
        <div class="snum"><span>${i + 1}</span></div>
        <select data-f="steps.${i}.pot" aria-label="Pot for step ${i + 1}">${potOpts}</select>
        <input class="splace" data-f="steps.${i}.place" value="${esc(st.place)}" aria-label="Place" maxlength="24">
        ${st.fast ? '<div class="fastchip sm">Can\'t pause</div>' : ''}
        <div class="sacts">
          <button type="button" class="icon" data-tap="up:${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${I.up()}</button>
          <button type="button" class="icon" data-tap="down:${i}" aria-label="Move down" ${i === d.steps.length - 1 ? 'disabled' : ''}>${I.down()}</button>
          <button type="button" class="icon" data-tap="delstep:${i}" aria-label="Delete step" ${d.steps.length === 1 ? 'disabled' : ''}>${I.trash(18)}</button>
        </div>
      </div>
      <input class="shl" data-f="steps.${i}.headline" value="${esc(st.headline)}" aria-label="Headline" maxlength="90" placeholder="Verb first, six words or fewer">
      ${preview !== st.headline ? `<div class="sprev">Shows as: ${esc(preview)}</div>` : ''}
      <div class="srow">
        <label>Timer <select data-timer="${i}">${['none', 'countdown', 'checkin', 'whistle'].map((x) => `<option value="${x}" ${k === x ? 'selected' : ''}>${{ none: 'None', countdown: 'Countdown', checkin: 'Check after', whistle: 'Whistles' }[x]}</option>`).join('')}</select></label>
        ${k === 'whistle' ? `<label><input type="number" min="1" max="12" step="1" data-tnum="${i}" value="${t.target}"> whistles</label>` : ''}
        ${k === 'countdown' || k === 'checkin' ? `<label><input type="number" min="0.5" max="240" step="0.5" data-tnum="${i}" value="${t.minutes}"> min</label>` : ''}
        <label class="grow">Done when <input data-cue="${i}" value="${esc(st.cue && st.cue.kind === 'text' ? st.cue.text : '')}" placeholder="e.g. golden brown" maxlength="80"></label>
      </div>
      <button type="button" class="more" data-tap="expand:${i}">${open ? 'Less' : 'More: details, video time, can\'t pause'}</button>
      ${open ? `<div class="smore">
        <label class="col">Details, read from the counter <textarea data-f="steps.${i}.detail" rows="2" maxlength="260">${esc(st.detail || '')}</textarea></label>
        <div class="srow">
          <label><input type="checkbox" data-flagf="steps.${i}.fast" ${st.fast ? 'checked' : ''}> Can't pause (warn one step early)</label>
          ${whistled ? `<label><input type="checkbox" data-wait="${i}" ${st.waitFor ? 'checked' : ''}> Wait until the cooker is safe to open</label>` : ''}
        </div>
        ${isYt ? `<div class="srow"><label>Video from <input class="tm" data-vt="${i}:start" value="${st.video ? fmtTime(st.video.start) : ''}" placeholder="0:00"></label><label>to <input class="tm" data-vt="${i}:end" value="${st.video && st.video.end != null ? fmtTime(st.video.end) : ''}" placeholder="next step"></label></div>` : ''}
      </div>` : ''}
    </div>`;
  }

  function ingredientRows() {
    const d = ui.draft;
    const ids = Object.keys(d.ingredients);
    if (!ids.length) return '<div class="muted">No ingredients yet.</div>';
    return ids.map((id) => {
      const ing = d.ingredients[id];
      return `<div class="iedit"><input data-f="ingredients.${id}.name" value="${esc(ing.name)}" aria-label="Ingredient name" maxlength="40">
        <input class="q" type="number" min="0" step="0.25" data-num="ingredients.${id}.qty" value="${ing.qty == null ? '' : ing.qty}" placeholder="none" aria-label="Quantity">
        <input class="u" data-f="ingredients.${id}.unit" value="${esc(ing.unit)}" aria-label="Unit" maxlength="16">
        <code title="Use {${esc(id)}} in a step to show this amount, rescaled">{${esc(id)}}</code></div>`;
    }).join('');
  }

  function reviewView() {
    const d = ui.draft;
    const potsHtml = d.pots.map((p, i) => `<div class="pedit"><i style="background:${LANES[i].color}"></i>
      <input data-f="pots.${i}.name" value="${esc(p.name)}" aria-label="Pot name" maxlength="24">
      <select data-f="pots.${i}.vessel" aria-label="Vessel">${VESSELS.map((v) => `<option value="${v}" ${p.vessel === v ? 'selected' : ''}>${v === 'other' ? 'Other' : v.charAt(0).toUpperCase() + v.slice(1)}</option>`).join('')}</select>
      <button type="button" class="icon" data-tap="delpot:${i}" aria-label="Remove pot" ${d.pots.length === 1 ? 'disabled' : ''}>${I.trash(18)}</button></div>`).join('');
    const vid = d.source.kind === 'youtube' && d.source.videoId;
    return `<div class="review">
      <div class="rv-head">
        <div style="min-width:0"><div class="lib-k">${ui.mode === 'edit' ? 'Edit recipe' : 'Check before you cook'}</div><h1>${esc(d.title || 'New recipe')}</h1></div>
        <div class="rv-btns"><button type="button" class="ghost" data-tap="${ui.mode === 'edit' ? 'cancel-edit' : 'discard'}">${ui.mode === 'edit' ? 'Cancel' : 'Discard'}</button><button type="button" class="primary" data-tap="save">${I.check(22, '#fff')}<span>Save recipe</span></button></div>
      </div>
      <div class="rv-body">
        <div class="rv-left">
          <label class="col">Name <input data-f="title" value="${esc(d.title)}" maxlength="80" placeholder="e.g. Rajma chawal"></label>
          <div class="col"><div class="lbl">The quantities serve</div>
            <div class="stepper sm"><button type="button" data-tap="bs-minus" aria-label="Fewer">${I.minus(20)}</button><div class="n">${d.baseServings}</div><button type="button" data-tap="bs-plus" aria-label="More">${I.plus(20)}</button></div></div>
          <div class="col"><div class="lbl">Pots on the stove (up to 3, one colour each)</div>${potsHtml}
            ${d.pots.length < 3 ? `<button type="button" class="ghost sm" data-tap="addpot">${I.plus(18)}<span>Add a pot</span></button>` : ''}</div>
          ${vid ? `<div class="vthumb sm"><img src="https://i.ytimg.com/vi/${vid}/mqdefault.jpg" alt="" width="128" height="72" onerror="this.style.display='none'"><div>Each step plays its part of the video, then waits for you.</div></div>` : ''}
          ${ui.warnings.length ? `<div class="warns"><div class="k">${I.warn(18, '#AA3606')} Check these</div>${ui.warnings.map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : ''}
          ${ui.method ? `<div class="muted">Read with: ${esc(ui.method)}</div>` : ''}
          ${ui.error ? `<div class="err">${I.warn(20, '#AA3606')}<div>${esc(ui.error)}</div></div>` : ''}
        </div>
        <div class="rv-right" id="rvScroll">
          <div class="sec">Steps · ${d.steps.length}</div>
          ${d.steps.map(stepEditor).join('')}
          <button type="button" class="ghost sm" data-tap="addstep">${I.plus(18)}<span>Add a step</span></button>
          <div class="sec" style="margin-top:18px">Ingredients · ${Object.keys(d.ingredients).length}</div>
          ${ingredientRows()}
          <button type="button" class="ghost sm" data-tap="adding">${I.plus(18)}<span>Add an ingredient</span></button>
        </div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- editing helpers
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { o = o[keys[i]]; if (o == null) return; }
    o[keys[keys.length - 1]] = value;
  }

  const potLabel = (d, id) => (d.pots.find((p) => p.id === id) || d.pots[0]).name;
  const potVessel = (d, id) => VESSEL_NAMES[(d.pots.find((p) => p.id === id) || d.pots[0]).vessel];

  function setTimer(i, kind) {
    const d = ui.draft;
    const st = d.steps[i];
    const old = timerOf(st);
    if (kind === 'none') { delete st.onEnter; return; }
    if (!st.pot) st.pot = d.pots[0].id;
    const label = potLabel(d, st.pot);
    const vessel = potVessel(d, st.pot);
    const cue = st.cue && st.cue.kind === 'text' ? st.cue.text : '';
    let t;
    if (kind === 'whistle') t = { slot: st.pot, type: 'whistle', label, sub: `${vessel} · listening for whistles`, target: old && old.target ? old.target : 3 };
    else if (kind === 'checkin') t = { slot: st.pot, type: 'checkin', label, sub: `${vessel} · ${cue ? cue.toLowerCase() : 'check it'}`, ask: cue ? `${cue}?` : 'Ready?', minutes: old && old.minutes ? old.minutes : 5 };
    else t = { slot: st.pot, type: 'countdown', label, sub: `${vessel} · ${old && old.minutes ? old.minutes : 5} min`, minutes: old && old.minutes ? old.minutes : 5, then: old && old.type === 'countdown' ? old.then : undefined };
    st.onEnter = [t];
  }

  function syncTimerPot(st) {
    const t = timerOf(st);
    if (!t) return;
    if (!st.pot) { delete st.onEnter; return; }
    t.slot = st.pot;
    t.label = potLabel(ui.draft, st.pot);
  }

  function save() {
    const d = ui.draft;
    if (!d.title.trim()) { ui.error = 'Give the recipe a name.'; render(); return; }
    if (!d.steps.some((s) => s.headline.trim())) { ui.error = 'Add at least one step.'; render(); return; }
    // Pot ids follow their names, so a renamed pot keeps its timers.
    const warnings = [];
    const clean = normalizeRecipe(d, { warnings });
    store.saveRecipe(clean);
    log(`saved recipe ${clean.title}`);
    ui.draft = null;
    ui.importText = '';
    openRecipe(store.getRecipe(clean.id) || clean);
  }

  function keepScroll(fn) {
    const el = document.getElementById('rvScroll');
    const top = el ? el.scrollTop : 0;
    fn();
    render();
    const el2 = document.getElementById('rvScroll');
    if (el2) el2.scrollTop = top;
  }

  // ---------------------------------------------------------------- events (wired up by app.js)
  function onTap(a) {
    if (a === 'add') { S.screen = 'add'; ui.status = ui.status === 'loading' ? 'loading' : 'idle'; render(); return true; }
    if (a.startsWith('open:')) { ui.confirmDel = null; const r = store.getRecipe(a.slice(5)); if (r) openRecipe(r); return true; }
    if (a.startsWith('askdel:')) { ui.confirmDel = a.slice(7); render(); return true; }
    if (a.startsWith('del:')) { store.deleteRecipe(a.slice(4)); ui.confirmDel = null; render(); return true; }
    if (a === 'import') { runImport(); return true; }
    if (a === 'cancel-import') { ui.cancelled = true; if (importCtl) importCtl.abort(); return true; }
    if (a === 'sample') { ui.importText = SAMPLE; render(); return true; }
    if (a === 'scratch') { openReview(blankRecipe(), [], '', 'new'); return true; }
    if (a === 'edit') { openReview(S.recipe, [], '', 'edit'); return true; }
    if (S.screen !== 'review') return false;
    const d = ui.draft;
    if (a === 'discard') { ui.draft = null; S.screen = 'add'; render(); return true; }
    if (a === 'cancel-edit') { ui.draft = null; S.screen = 'start'; render(); return true; }
    if (a === 'save') { save(); return true; }
    keepScroll(() => {
      if (a === 'bs-minus') d.baseServings = Math.max(1, d.baseServings - 1);
      if (a === 'bs-plus') d.baseServings = Math.min(24, d.baseServings + 1);
      if (a === 'addpot' && d.pots.length < 3) {
        let n = d.pots.length + 1;
        while (d.pots.some((p) => p.id === `pot${n}`)) n++;
        d.pots.push({ id: `pot${n}`, name: `Pot ${n}`, vessel: 'pot' });
      }
      if (a.startsWith('delpot:') && d.pots.length > 1) {
        const [gone] = d.pots.splice(Number(a.slice(7)), 1);
        d.steps.forEach((s) => { if (s.pot === gone.id) { s.pot = null; delete s.onEnter; } if (s.waitFor === gone.id) delete s.waitFor; });
      }
      if (a === 'addstep') { d.steps.push({ place: 'Counter', pot: null, headline: '', detail: '' }); ui.expanded = d.steps.length - 1; }
      if (a.startsWith('delstep:') && d.steps.length > 1) d.steps.splice(Number(a.slice(8)), 1);
      if (a.startsWith('up:')) { const i = Number(a.slice(3)); if (i > 0) [d.steps[i - 1], d.steps[i]] = [d.steps[i], d.steps[i - 1]]; }
      if (a.startsWith('down:')) { const i = Number(a.slice(5)); if (i < d.steps.length - 1) [d.steps[i + 1], d.steps[i]] = [d.steps[i], d.steps[i + 1]]; }
      if (a.startsWith('expand:')) { const i = Number(a.slice(7)); ui.expanded = ui.expanded === i ? null : i; }
      if (a === 'adding') {
        let key = 'item';
        let n = 1;
        while (d.ingredients[`${key}${n}`]) n++;
        d.ingredients[`${key}${n}`] = { name: 'New ingredient', qty: null, unit: '', kind: 'fixed', group: 'prep', aliases: [] };
      }
    });
    return true;
  }

  // Typing updates the draft without re-rendering, so the cursor stays where it is.
  function onInput(e) {
    const el = e.target;
    if (el.dataset.ui === 'code') { ui.code = el.value; try { localStorage.setItem('cookalong.importCode', el.value); } catch (_) { /* ignore */ } return true; }
    if (el.dataset.ui === 'importText') { ui.importText = el.value; const btn = document.querySelector('[data-tap="import"]'); if (btn) btn.disabled = !el.value.trim() || ui.status === 'loading'; return true; }
    if (!ui.draft) return false;
    if (el.dataset.f && el.tagName !== 'SELECT') { setPath(ui.draft, el.dataset.f, el.value); return true; }
    if (el.dataset.cue != null) {
      const st = ui.draft.steps[Number(el.dataset.cue)];
      if (el.value.trim()) st.cue = { kind: 'text', text: el.value }; else delete st.cue;
      const t = timerOf(st);
      if (t && t.type === 'checkin') t.ask = el.value.trim() ? `${el.value.trim()}?` : 'Ready?';
      return true;
    }
    return false;
  }

  function onChange(e) {
    const el = e.target;
    if (!ui.draft || S.screen !== 'review') return false;
    const d = ui.draft;
    // Text boxes save quietly (re-rendering on blur would steal focus from the box tapped next);
    // menus and checkboxes change the layout, so they re-render.
    const structural = el.tagName === 'SELECT' || el.type === 'checkbox';
    (structural ? keepScroll : (fn) => fn())(() => {
      if (el.dataset.f) {
        const v = el.value;
        setPath(d, el.dataset.f, v);
        const m = el.dataset.f.match(/^steps\.(\d+)\.pot$/);
        if (m) { const st = d.steps[Number(m[1])]; st.pot = v || null; syncTimerPot(st); }
        const pm = el.dataset.f.match(/^pots\.(\d+)\.name$/);
        if (pm) { const p = d.pots[Number(pm[1])]; d.steps.forEach((s) => (s.onEnter || []).forEach((t) => { if (t.slot === p.id) t.label = p.name; })); }
      }
      if (el.dataset.num) { const n = parseFloat(el.value); setPath(d, el.dataset.num, Number.isFinite(n) && n > 0 ? n : null); const id = el.dataset.num.split('.')[1]; const ing = d.ingredients[id]; if (ing) ing.kind = ing.qty == null ? 'fixed' : ing.kind === 'fixed' ? (ing.unit ? 'volume' : 'count') : ing.kind; }
      if (el.dataset.timer != null) setTimer(Number(el.dataset.timer), el.value);
      if (el.dataset.tnum != null) {
        const st = d.steps[Number(el.dataset.tnum)];
        const t = timerOf(st);
        const n = parseFloat(el.value);
        if (t && Number.isFinite(n) && n > 0) { if (t.type === 'whistle') t.target = Math.min(12, Math.round(n)); else { t.minutes = Math.min(240, n); if (t.type === 'countdown') t.sub = `${potVessel(d, t.slot)} · ${t.minutes} min`; } }
      }
      if (el.dataset.flagf) setPath(d, el.dataset.flagf, el.checked);
      if (el.dataset.wait != null) { const st = d.steps[Number(el.dataset.wait)]; if (el.checked) st.waitFor = st.pot; else delete st.waitFor; }
      if (el.dataset.vt) {
        const [i, which] = el.dataset.vt.split(':');
        const st = d.steps[Number(i)];
        const t = parseTime(el.value);
        st.video = st.video || { start: 0, end: null };
        if (which === 'start') { if (t == null) delete st.video; else st.video.start = t; } else st.video.end = t;
      }
    });
    return true;
  }

  function view() {
    if (S.screen === 'add') return addView();
    if (S.screen === 'review' && ui.draft) return reviewView();
    return libraryView();
  }

  return { view, onTap, onInput, onChange, openReview };
}

export { slug };
