// Recipe format and helpers. A recipe is plain data (no functions), so it can be saved, imported,
// edited on the review screen and restored after a reload. The engine in app.js only reads this shape.
//
// Recipe (v1):
//   id, title, source { kind: builtin|blog|text|youtube, url?, videoId?, site?, author? }
//   baseServings, chips[], pots[] (1 to 3; the index is the colour lane), ingredients { id: Ingredient }, groups[]
//   steps[]: { place, pot, icon?, headline, detail?, say?, cue?, checklist?, lineup?, beats?, onEnter?[], waitFor?, fast?, video? }
//   tips[], finishLine?, doneTitle?, doneLine?, scaleFixes?[]
// Ingredient: { name, qty (number or null), unit, kind: volume|count|weight|fixed, group, aliases[] }
// TimerSpec: { slot, type: countdown|checkin|whistle|cooling, label, sub, minutes | target, ask?, opens?, then?: Outcome }
// Outcome:   { doneText?, notify? { text, sub, speak? }, alert? { kicker, sub, title, body, next?: TimerSpec } }
// Text fields may hold {ingredientId} placeholders; they become scaled quantities when shown or spoken.

export const VESSELS = ['cooker', 'pot', 'kadai', 'pan', 'tawa', 'oven', 'bowl', 'other'];
export const VESSEL_NAMES = { cooker: 'pressure cooker', pot: 'pot', kadai: 'kadai', pan: 'pan', tawa: 'tawa', oven: 'oven', bowl: 'bowl', other: 'pot' };
export const MAX_POTS = 3;

// One colour per lane, in a fixed order: yellow, blue, orange. Text on each passes 4.5:1 (see tools/color_contrast.py).
export const LANES = [
  { color: 'var(--dal)', tint: 'var(--dal-tint)', deep: 'var(--dal-deep)', track: '#F4D57A', ink: '#171B20', chime: 'dal' },
  { color: 'var(--rice)', tint: 'var(--rice-tint)', deep: 'var(--rice)', track: 'var(--rice-track)', ink: '#FFFFFF', chime: 'rice' },
  { color: 'var(--masala)', tint: 'var(--masala-tint)', deep: 'var(--masala-deep)', track: 'var(--masala-track)', ink: '#171B20', chime: 'kadai' },
];

// ---------------------------------------------------------------- the built-in recipe
export const DAL_TADKA = {
  v: 1,
  id: 'dal-tadka',
  title: 'Dal tadka + jeera rice',
  crumb: 'Built-in recipe',
  source: { kind: 'builtin' },
  baseServings: 2,
  chips: ['About 45 min', '3 pots at once', 'Pressure cooker'],
  pots: [
    { id: 'dal', name: 'Dal', vessel: 'cooker' },
    { id: 'rice', name: 'Rice', vessel: 'pot' },
    { id: 'kadai', name: 'Kadai', vessel: 'kadai' },
  ],
  // kind: 'volume' rounds to quarters, 'count' rounds to whole numbers (min 1)
  ingredients: {
    toor: { name: 'Toor dal', qty: 0.5, unit: 'cup', kind: 'volume', group: 'dal', aliases: ['dal', 'daal', 'toor'] },
    dalWater: { name: 'Water', qty: 1.5, unit: 'cup', kind: 'volume', group: 'dal', aliases: ['water', 'paani', 'pani'] },
    haldi: { name: 'Haldi', qty: 0.25, unit: 'tsp', kind: 'volume', group: 'dal', aliases: ['haldi', 'turmeric'] },
    dalSalt: { name: 'Salt', qty: 0.5, unit: 'tsp', kind: 'volume', group: 'dal', aliases: ['salt', 'namak'] },
    rice: { name: 'Basmati rice', qty: 0.75, unit: 'cup', kind: 'volume', group: 'rice', aliases: ['rice', 'chawal', 'chaawal'] },
    riceWater: { name: 'Water', qty: 1.5, unit: 'cup', kind: 'volume', group: 'rice', aliases: ['water', 'paani', 'pani'] },
    riceGhee: { name: 'Ghee', qty: 1, unit: 'tsp', kind: 'volume', group: 'rice', aliases: ['ghee'] },
    riceJeera: { name: 'Jeera', qty: 0.5, unit: 'tsp', kind: 'volume', group: 'rice', aliases: ['jeera', 'cumin'] },
    bay: { name: 'Bay leaves', qty: 1, unit: '', kind: 'count', group: 'rice', aliases: ['bay leaf', 'tej patta'] },
    riceSalt: { name: 'Salt', qty: 0.5, unit: 'tsp', kind: 'volume', group: 'rice', aliases: ['salt', 'namak'] },
    masalaGhee: { name: 'Ghee', qty: 0.5, unit: 'tbsp', kind: 'volume', group: 'kadai', aliases: ['ghee'] },
    onions: { name: 'Onions', qty: 1, unit: '', kind: 'count', group: 'kadai', aliases: ['onion', 'onions', 'pyaaz', 'pyaz'] },
    tomatoes: { name: 'Tomatoes', qty: 1, unit: '', kind: 'count', group: 'kadai', aliases: ['tomato', 'tomatoes', 'tamatar'] },
    chillies: { name: 'Green chillies', qty: 1, unit: '', kind: 'count', group: 'kadai', aliases: ['green chilli', 'green chillies', 'hari mirch'] },
    tadkaGhee: { name: 'Ghee', qty: 1, unit: 'tbsp', kind: 'volume', group: 'tadka', aliases: ['ghee'] },
    tadkaJeera: { name: 'Jeera', qty: 0.5, unit: 'tsp', kind: 'volume', group: 'tadka', aliases: ['jeera', 'cumin'] },
    garlic: { name: 'Garlic', qty: 4, unit: 'cloves', kind: 'count', group: 'tadka', aliases: ['garlic', 'lehsun', 'lahsun'] },
    redChillies: { name: 'Dried red chillies', qty: 2, unit: '', kind: 'count', group: 'tadka', aliases: ['red chilli', 'red chillies', 'sukhi mirch'] },
    hing: { name: 'Hing', qty: 1, unit: 'pinch', kind: 'count', group: 'tadka', aliases: ['hing', 'asafoetida'] },
    chilliPowder: { name: 'Chilli powder', qty: 0.5, unit: 'tsp', kind: 'volume', group: 'tadka', aliases: ['chilli powder', 'lal mirch'] },
    coriander: { name: 'Coriander', qty: 2, unit: 'tbsp', kind: 'volume', group: 'finish', aliases: ['coriander', 'dhania', 'dhaniya'] },
    lemon: { name: 'Lemon', qty: 0.25, unit: '', kind: 'volume', group: 'finish', aliases: ['lemon', 'nimbu', 'nimboo'] },
  },
  groups: [
    { key: 'dal', title: 'Dal', sub: 'cooker', lane: 'dal', ids: ['toor', 'dalWater', 'haldi', 'dalSalt'] },
    { key: 'rice', title: 'Rice', sub: 'pot', lane: 'rice', ids: ['rice', 'riceWater', 'riceGhee', 'riceJeera', 'bay', 'riceSalt'] },
    { key: 'kadai', title: 'Masala', sub: 'kadai', lane: 'kadai', ids: ['masalaGhee', 'onions', 'tomatoes', 'chillies'] },
    { key: 'tadka', title: 'Tadka', sub: 'small pan', lane: 'kadai', icon: 'flame', ids: ['tadkaGhee', 'tadkaJeera', 'garlic', 'redChillies', 'hing', 'chilliPowder'] },
  ],
  finishLine: 'To finish: {coriander} chopped coriander, {lemon} lemon.',
  tips: [
    { kind: 'whistles' },
    { kind: 'cooker', ids: ['dalWater', 'toor'] },
  ],
  doneTitle: "Dinner's ready",
  doneLine: 'Coriander on the dal, a squeeze of lemon, rice fluffed with a fork.',
  scaleFixes: [
    { pot: 'dal', when: 'more', fromStep: 2, title: 'Dal: stretch it', body: 'Add 1 cup hot water and ½ tsp salt when you mash it. It will be a little thinner.' },
    { pot: 'rice', when: 'more', fromStep: 4, title: 'Rice: top it up', body: 'Cook {more:rice} cup more in a second pot.' },
    { pot: 'dal', when: 'less', fromStep: 2, title: 'Dal and rice: leftovers', body: "They're already cooking for {servings}. Keep the extra for tomorrow." },
  ],
  // Step fields:
  //   place: chip label; pot: which colour the chip uses (or null); icon: overrides the chip icon
  //   headline: six words or fewer, verb first; {id} placeholders become scaled quantities
  //   detail: the counter-distance line
  //   say: optional spoken version, used when the screen text holds command words the app must not say aloud
  //   cue: optional doneness scale or 'done when' text
  //   onEnter: timers to start when the step is reached
  //   waitFor: a pot whose timer must say it is safe (opens: true) before this step
  //   checklist / lineup / beats: special step bodies
  steps: [
    {
      place: 'Counter', pot: 'rice',
      headline: 'Rinse and soak the rice',
      detail: '{rice} basmati, rinsed 3 times, then covered with water.',
      onEnter: [{ slot: 'rice', type: 'countdown', label: 'Rice', sub: 'bowl · soaking', minutes: 15,
        then: { doneText: 'Soaked', notify: { text: 'Rice has soaked', sub: 'Drain it when you reach the rice step.' } } }],
    },
    {
      place: 'Sink', pot: 'dal',
      headline: 'Rinse the dal 3 times',
      detail: '{toor} toor dal, until the water runs almost clear.',
    },
    {
      place: 'Cooker', pot: 'dal',
      headline: 'Pressure cook the dal: 3 whistles',
      detail: 'Dal, {dalWater} water, {haldi} haldi and {dalSalt} salt. Lid on, medium flame.',
      onEnter: [{ slot: 'dal', type: 'whistle', label: 'Dal', sub: 'cooker · listening for whistles', target: 3,
        then: { alert: { kicker: 'Dal · cooker', sub: '{ordinal} whistle heard just now', title: 'Turn off the flame',
          body: "Let the pressure drop by itself, about 10 min. Don't open the lid yet.",
          next: { slot: 'dal', type: 'cooling', label: 'Dal', sub: 'cooker · flame off, cooling', minutes: 10, opens: true,
            then: { doneText: 'Safe to open', notify: { text: 'Dal: safe to open the cooker', sub: 'The pressure has dropped.' } } } } } }],
    },
    {
      place: 'Counter', pot: null,
      headline: 'Chop everything now',
      detail: 'Say “onions done” to tick one off, or hold it with a knuckle.',
      say: 'Chop everything now: onions, tomatoes, green chillies, and garlic for the tadka.',
      checklist: ['{onions} onions, finely chopped', '{tomatoes} tomatoes, chopped', '{chillies} green chillies, slit', 'Garlic, {garlic}, sliced'],
    },
    {
      place: 'Rice pot', pot: 'rice',
      headline: 'Start the rice',
      detail: '{riceGhee} ghee, {riceJeera} jeera, bay leaves ({bay}). Then the drained rice, {riceWater} water, {riceSalt} salt. Boil, then lowest flame, lid on.',
      onEnter: [{ slot: 'rice', type: 'countdown', label: 'Rice', sub: 'pot · low flame, lid on', minutes: 12,
        then: { alert: { kicker: 'Rice · pot', sub: 'Timer done', title: 'Turn the flame off', body: 'Leave the lid on and let it rest for 5 minutes.',
          next: { slot: 'rice', type: 'countdown', label: 'Rice', sub: 'pot · resting, lid on', minutes: 5,
            then: { doneText: 'Ready', notify: { text: 'Rice is ready', sub: 'Keep the lid on until you serve.' } } } } } }],
    },
    {
      place: 'Kadai', pot: 'kadai',
      headline: 'Sauté {onions} onions till golden',
      detail: 'Chopped, into {masalaGhee} hot ghee, on a medium flame.',
      cue: { kind: 'doneness', stops: [['#F1E6CF', 'Raw'], ['#E8CB8E', 'Soft, see-through'], ['#C9862F', 'Golden: stop here'], ['#74461C', 'Too far, bitter']], target: 2 },
      onEnter: [{ slot: 'kadai', type: 'checkin', label: 'Onions', sub: 'kadai · check for golden', ask: 'Golden yet?', minutes: 4 }],
    },
    {
      place: 'Kadai', pot: 'kadai',
      headline: 'Add {tomatoes} tomatoes and {chillies} chillies',
      detail: 'Tomatoes chopped, green chillies slit. Stir and cook till mushy.',
      cue: { kind: 'text', text: 'Mushy, and oil shows at the edges' },
      onEnter: [{ slot: 'kadai', type: 'checkin', label: 'Masala', sub: 'kadai · cook till mushy', ask: 'Mushy, with oil at the edges?', minutes: 4 }],
    },
    {
      place: 'Tadka pan', pot: 'kadai', icon: 'flame',
      headline: 'Line up the tadka',
      detail: 'It moves fast. Ready these, in order:',
      say: 'Line up the tadka. It moves fast once the ghee is hot. Ghee, jeera, garlic, dried red chillies, then hing and chilli powder.',
      lineup: [['Ghee', '{tadkaGhee}'], ['Jeera', '{tadkaJeera}'], ['Garlic, sliced', '{garlic}'], ['Dried red chillies', '{redChillies}'], ['Hing + chilli powder', '{hing} + {chilliPowder}']],
    },
    {
      place: 'Cooker', pot: 'dal', waitFor: 'dal',
      headline: 'Mash the dal, add the masala',
      detail: 'Whisk the dal smooth, stir in the masala and ½ cup hot water. Simmer 5 min.',
      onEnter: [{ slot: 'dal', type: 'countdown', label: 'Dal', sub: 'simmering with masala', minutes: 5,
        then: { doneText: 'Simmered', notify: { text: 'Dal has simmered', sub: 'Tadka next.' } } }],
    },
    {
      place: 'Tadka pan', pot: 'kadai', icon: 'flame',
      headline: 'Tadka',
      beats: [
        { label: 'Ghee hot', headline: 'Heat the ghee', detail: '{tadkaGhee} ghee, until it shimmers. Say “ho gaya” when it does.', seconds: 0, prompt: '“ho gaya”', say: 'Ghee garam karo. Chamakne lage toh bataiye.', sayHi: 'घी गरम करो। चमकने लगे तो बताइए।' },
        { label: 'Jeera', headline: 'Jeera in', detail: '{tadkaJeera} jeera. Let it crackle.', seconds: 10, say: 'Ab jeera daalo.', sayHi: 'अब जीरा डालो।' },
        { label: 'Garlic', headline: 'Garlic in', detail: 'Garlic, {garlic}, sliced. Stir until just golden, not brown.', seconds: 30, say: 'Ab lehsun daalo, golden hone tak.', sayHi: 'अब लहसुन डालो, गोल्डन होने तक।', then: 'Then: flame off first, so the chilli powder doesn\'t burn' },
        { label: 'Chilli + hing', headline: 'Flame off, then chilli', detail: '{redChillies} red chillies, {hing} hing, {chilliPowder} chilli powder.', seconds: 6, say: 'Gas band karo. Ab mirchi, hing aur lal mirch.', sayHi: 'गैस बंद करो। अब मिर्ची, हींग और लाल मिर्च।' },
        { label: 'Pour on dal', headline: 'Pour it on the dal', detail: 'Straight away, while it sizzles. Say “ho gaya” after.', seconds: 0, prompt: '“ho gaya”', say: 'Turant daal ke upar daal do.', sayHi: 'तुरंत दाल के ऊपर डाल दो।' },
      ],
    },
    {
      place: 'Plate', pot: null, icon: 'plate',
      headline: 'Garnish and serve',
      detail: '{coriander} coriander and a squeeze of lemon on the dal. Fluff the rice with a fork.',
    },
  ],
};

// ---------------------------------------------------------------- quantities
const FRACTIONS = [[0, ''], [0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1, '']];
const PLURALS = { cup: 'cups', pinch: 'pinches', clove: 'cloves', piece: 'pieces', slice: 'slices', handful: 'handfuls', sprig: 'sprigs', inch: 'inches', stick: 'sticks', leaf: 'leaves' };

export function scaledQty(recipe, id, servings) {
  const ing = recipe.ingredients[id];
  if (!ing || ing.qty == null) return null;
  if (ing.kind === 'fixed') return ing.qty;
  const raw = ing.qty * servings / recipe.baseServings;
  if (ing.kind === 'count') return Math.max(1, Math.round(raw));
  if (ing.kind === 'weight') {
    const u = (ing.unit || '').toLowerCase();
    if (u === 'kg' || u === 'l') return Math.max(0.05, Math.round(raw * 20) / 20);
    return raw >= 20 ? Math.round(raw / 5) * 5 : Math.max(1, Math.round(raw));
  }
  return Math.max(0.25, Math.round(raw * 4) / 4);
}

export function fmtNumber(q) {
  let whole = Math.floor(q);
  const frac = q - whole;
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f;
  if (best[0] === 1) { whole += 1; best = FRACTIONS[0]; }
  if (whole === 0 && best[1]) return best[1];
  return `${whole}${best[1]}`;
}

export function fmtQty(recipe, id, servings) {
  const ing = recipe.ingredients[id];
  if (!ing) return '';
  const q = scaledQty(recipe, id, servings);
  if (q == null) return ing.unit || 'to taste';
  const n = ing.kind === 'weight' && !Number.isInteger(q) ? String(q) : fmtNumber(q);
  if (!ing.unit) return n;
  let unit = ing.unit;
  if (q > 1 && PLURALS[unit]) unit = PLURALS[unit];
  return ing.kind === 'weight' && /^(g|kg|ml|l)$/i.test(unit) ? `${n} ${unit}` : `${n} ${unit}`;
}

// Replace {id} placeholders. mode 'html' wraps quantities in a highlight span.
export function fill(recipe, text, servings, mode = 'text') {
  if (!text) return '';
  return String(text).replace(/\{(\w+)\}/g, (_, id) => {
    if (!recipe.ingredients[id]) return `{${id}}`;
    const q = fmtQty(recipe, id, servings);
    return mode === 'html' ? `<mark class="qty">${escapeHtml(q)}</mark>` : q;
  });
}

export function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Text the cook typed or a model wrote is escaped before it reaches the page; quantities are added after.
export function fillSafe(recipe, text, servings, mode = 'text') {
  if (!text) return '';
  if (recipe.source && recipe.source.kind === 'builtin') return fill(recipe, text, servings, mode);
  const parts = String(text).split(/(\{\w+\})/g);
  return parts.map((p) => (/^\{\w+\}$/.test(p) ? fill(recipe, p, servings, mode) : escapeHtml(p))).join('');
}

export function findIngredientByWord(recipe, text) {
  const t = text.toLowerCase();
  for (const [id, ing] of Object.entries(recipe.ingredients)) {
    for (const a of ing.aliases || []) if (a && t.includes(a.toLowerCase())) return id;
  }
  return null;
}

export const potIndex = (recipe, potId) => recipe.pots.findIndex((p) => p.id === potId);
export const potOf = (recipe, potId) => recipe.pots.find((p) => p.id === potId) || null;
export function laneOf(recipe, potId) {
  const i = potIndex(recipe, potId);
  return i >= 0 ? LANES[i] : null;
}

// ---------------------------------------------------------------- validation
// Used on every recipe that comes from outside the code (an import, the review screen, storage), so the
// engine can trust the shape. It repairs what it can and lists what it changed in `warnings`.
export function normalizeRecipe(input, { warnings = [] } = {}) {
  const r = JSON.parse(JSON.stringify(input || {}));
  const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

  r.v = 1;
  r.id = str(r.id, 80) || `r-${Date.now().toString(36)}`;
  r.title = str(r.title, 80) || 'Untitled recipe';
  r.source = r.source && typeof r.source === 'object' ? r.source : { kind: 'text' };
  if (!['builtin', 'blog', 'text', 'youtube'].includes(r.source.kind)) r.source.kind = 'text';
  r.baseServings = Math.round(num(r.baseServings, 1, 24) || 2);
  r.chips = Array.isArray(r.chips) ? r.chips.map((c) => str(c, 40)).filter(Boolean).slice(0, 4) : [];

  // Pots: 1 to 3, unique ids.
  let pots = Array.isArray(r.pots) ? r.pots : [];
  pots = pots.map((p, i) => ({ id: slug(str(p && p.id, 24) || str(p && p.name, 24) || `pot${i + 1}`), name: str(p && p.name, 24) || `Pot ${i + 1}`, vessel: VESSELS.includes(p && p.vessel) ? p.vessel : 'pot' }));
  const seen = new Set();
  pots = pots.filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  if (pots.length > MAX_POTS) { warnings.push(`Only ${MAX_POTS} pots fit on the timer rail; ${pots.slice(MAX_POTS).map((p) => p.name).join(', ')} merged into ${pots[MAX_POTS - 1].name}.`); }
  const overflow = new Map(pots.slice(MAX_POTS).map((p) => [p.id, pots[MAX_POTS - 1].id]));
  pots = pots.slice(0, MAX_POTS);
  if (!pots.length) pots = [{ id: 'pot', name: 'Pot', vessel: 'pot' }];
  r.pots = pots;
  const potIds = new Set(pots.map((p) => p.id));
  const fixPot = (id) => (id == null || id === '' ? null : potIds.has(id) ? id : overflow.has(id) ? overflow.get(id) : null);

  // Ingredients.
  const ingredients = {};
  for (const [id, ing] of Object.entries(r.ingredients || {})) {
    if (!ing || typeof ing !== 'object') continue;
    const key = slug(id);
    const qty = num(ing.qty, 0, 100000);
    ingredients[key] = {
      name: str(ing.name, 40) || key,
      qty: qty === 0 ? null : qty,
      unit: str(ing.unit, 16),
      kind: ['volume', 'count', 'weight', 'fixed'].includes(ing.kind) ? ing.kind : 'fixed',
      group: str(ing.group, 24) || 'prep',
      aliases: Array.isArray(ing.aliases) ? ing.aliases.map((a) => str(a, 30).toLowerCase()).filter(Boolean).slice(0, 6) : [],
    };
    if (!ingredients[key].aliases.length) ingredients[key].aliases = [ingredients[key].name.toLowerCase()];
  }
  r.ingredients = ingredients;
  r.groups = (Array.isArray(r.groups) ? r.groups : []).map((g) => ({
    key: str(g.key, 24) || 'prep', title: str(g.title, 24) || 'Prep', sub: str(g.sub, 24), lane: fixPot(g.lane) , icon: g.icon === 'flame' ? 'flame' : undefined,
    ids: (Array.isArray(g.ids) ? g.ids : []).map((x) => slug(x)).filter((x) => ingredients[x]),
  })).filter((g) => g.ids.length).slice(0, 6);

  // Steps.
  const steps = (Array.isArray(r.steps) ? r.steps : []).slice(0, 40).map((s) => normalizeStep(s, { fixPot, ingredients, str, num, warnings, potIds }));
  r.steps = steps.filter((s) => s.headline);
  if (!r.steps.length) { warnings.push('No steps were found.'); r.steps = [{ place: 'Counter', pot: null, headline: 'Add your first step', detail: '' }]; }

  r.tips = Array.isArray(r.tips) ? r.tips.filter((t) => t && (t.kind === 'whistles' || t.kind === 'cooker' || (t.kind === 'text' && str(t.text)))).slice(0, 3) : [];
  r.finishLine = str(r.finishLine, 160);
  r.doneTitle = str(r.doneTitle, 30) || 'Ready to serve';
  r.doneLine = str(r.doneLine, 160) || 'Plate up while it is hot.';
  r.scaleFixes = Array.isArray(r.scaleFixes) ? r.scaleFixes.slice(0, 4) : [];
  if (r.source.kind === 'youtube' && !/^[\w-]{11}$/.test(r.source.videoId || '')) { r.source.videoId = null; }
  return r;
}

function normalizeStep(s, { fixPot, str, num, warnings, potIds }) {
  const step = {
    place: str(s && s.place, 24) || 'Counter',
    pot: fixPot(s && s.pot),
    headline: str(s && s.headline, 90),
    detail: str(s && s.detail, 260),
  };
  if (s.icon && ['flame', 'plate', 'knife'].includes(s.icon)) step.icon = s.icon;
  if (s.say) step.say = str(s.say, 300);
  if (s.cue && s.cue.kind === 'text' && str(s.cue.text)) step.cue = { kind: 'text', text: str(s.cue.text, 80) };
  if (s.cue && s.cue.kind === 'doneness' && Array.isArray(s.cue.stops)) step.cue = s.cue;
  if (Array.isArray(s.checklist) && s.checklist.length) step.checklist = s.checklist.map((c) => str(c, 60)).filter(Boolean).slice(0, 6);
  if (Array.isArray(s.lineup) && s.lineup.length) step.lineup = s.lineup.slice(0, 6);
  if (Array.isArray(s.beats) && s.beats.length) step.beats = s.beats;
  if (s.fast) step.fast = true;
  const wait = fixPot(s.waitFor);
  if (wait) step.waitFor = wait;
  if (s.video && typeof s.video === 'object') {
    const start = num(s.video.start, 0, 36000);
    const end = num(s.video.end, 0, 36000);
    if (start != null) step.video = { start, end: end != null && end > start ? end : null };
  }
  step.onEnter = (Array.isArray(s.onEnter) ? s.onEnter : []).map((t) => normalizeTimer(t, { fixPot, str, num, potIds })).filter(Boolean).slice(0, 2);
  if (!step.onEnter.length) delete step.onEnter;
  if (step.onEnter && step.onEnter.some((t) => !potIds.has(t.slot))) warnings.push(`A timer in “${step.headline}” had no pot.`);
  return step;
}

function normalizeTimer(t, { fixPot, str, num }) {
  if (!t || typeof t !== 'object') return null;
  const slot = fixPot(t.slot);
  if (!slot) return null;
  const type = ['countdown', 'checkin', 'whistle', 'cooling'].includes(t.type) ? t.type : 'countdown';
  const out = { slot, type, label: str(t.label, 20) || 'Timer', sub: str(t.sub, 40) };
  if (type === 'whistle') out.target = Math.round(num(t.target, 1, 12) || 3);
  else out.minutes = num(t.minutes, 0.1, 240) || 5;
  if (t.ask) out.ask = str(t.ask, 60);
  if (t.opens) out.opens = true;
  if (t.then && typeof t.then === 'object') {
    const th = {};
    if (t.then.doneText) th.doneText = str(t.then.doneText, 20);
    if (t.then.notify && str(t.then.notify.text)) th.notify = { text: str(t.then.notify.text, 60), sub: str(t.then.notify.sub, 90) };
    if (t.then.alert && str(t.then.alert.title)) {
      th.alert = { kicker: str(t.then.alert.kicker, 30), sub: str(t.then.alert.sub, 50), title: str(t.then.alert.title, 40), body: str(t.then.alert.body, 140) };
      const next = normalizeTimer(t.then.alert.next, { fixPot, str, num });
      if (next) th.alert.next = next;
    }
    out.then = th;
  }
  return out;
}

export function slug(s) {
  const out = String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s-]+(\w)/g, (_, c) => c.toUpperCase()).replace(/[^\w]/g, '');
  return (out.charAt(0).toLowerCase() + out.slice(1)).slice(0, 32) || 'x';
}

// Every {id} placeholder used anywhere in a step, for "how much" and the rescale preview.
export function idsInStep(recipe, st) {
  const txt = JSON.stringify([st.headline, st.detail, st.checklist, st.lineup, (st.beats || []).map((b) => b.detail)]);
  return [...new Set((txt.match(/\{(\w+)\}/g) || []).map((m) => m.slice(1, -1)).filter((id) => recipe.ingredients[id]))];
}

export function hasWhistles(recipe) {
  return recipe.steps.some((s) => (s.onEnter || []).some((t) => t.type === 'whistle'));
}
