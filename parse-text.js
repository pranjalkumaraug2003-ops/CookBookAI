// A rule-based recipe reader. It turns a plain-text recipe (a blog's recipe card, a chatbot answer, notes)
// into a draft Cook-Along recipe without any AI: section headings, quantities, vessels, times and whistles
// are all found with patterns. It is the fallback when the server or the model is unavailable, and the
// cook always checks its draft on the review screen before cooking.
import { slug, VESSELS } from './recipe.js';

const FRACTION_CHARS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const UNIT_WORDS = [
  ['tbsp', /^(tbsp|tbsps|tbs|tablespoons?|tbl|tblsp)\.?$/i], ['tsp', /^(tsp|tsps|teaspoons?)\.?$/i], ['cup', /^cups?$/i],
  ['g', /^(g|gm|gms|grams?|gr)\.?$/i], ['kg', /^(kg|kgs|kilos?|kilograms?)\.?$/i], ['ml', /^(ml|mls|millilit(?:er|re)s?)\.?$/i],
  ['l', /^(l|lit(?:er|re)s?|ltr)\.?$/i], ['pinch', /^pinch(es)?$/i], ['cloves', /^cloves?$/i], ['inch', /^inch(es)?$/i],
  ['piece', /^(pieces?|pcs?)$/i], ['handful', /^handfuls?$/i], ['sprig', /^sprigs?$/i], ['stick', /^sticks?$/i], ['leaf', /^leaves$|^leaf$/i],
];
const WEIGHT_UNITS = new Set(['g', 'kg', 'ml', 'l']);
const VOLUME_UNITS = new Set(['cup', 'tbsp', 'tsp']);

// Common Indian kitchen names, so "namak kitna?" finds the salt in an English recipe.
const HINDI = {
  salt: ['namak'], turmeric: ['haldi'], 'red chilli powder': ['lal mirch'], 'chilli powder': ['lal mirch'], 'cumin seeds': ['jeera'], cumin: ['jeera'],
  coriander: ['dhania', 'dhaniya'], 'coriander powder': ['dhania powder'], onion: ['pyaaz', 'pyaz'], onions: ['pyaaz', 'pyaz'], tomato: ['tamatar'], tomatoes: ['tamatar'],
  garlic: ['lehsun', 'lahsun'], ginger: ['adrak'], 'green chilli': ['hari mirch'], 'green chillies': ['hari mirch'], ghee: ['ghee'], oil: ['tel'], water: ['paani', 'pani'],
  rice: ['chawal'], potato: ['aloo'], potatoes: ['aloo'], 'garam masala': ['garam masala'], asafoetida: ['hing'], hing: ['hing'], sugar: ['cheeni', 'shakkar'],
  lemon: ['nimbu'], curd: ['dahi'], yogurt: ['dahi'], butter: ['makkhan'], cream: ['malai'], paneer: ['paneer'], peas: ['matar'], 'mustard seeds': ['rai', 'sarson'],
  'curry leaves': ['kadi patta'], 'bay leaf': ['tej patta'], flour: ['atta'], 'wheat flour': ['atta'], gram: ['chana'], chickpeas: ['chole', 'chana'], 'kidney beans': ['rajma'],
};

const VESSEL_PATTERNS = [
  ['cooker', /\b(pressure[- ]?cook(?:er|ed|ing)?|cooker|instant pot|whistles?|seeti)\b/i],
  ['kadai', /\b(kadai|kadhai|karahi|wok)\b/i],
  ['tawa', /\b(tawa|tava|griddle)\b/i],
  ['oven', /\b(oven|bake|baking tray|preheat)\b/i],
  ['pan', /\b(frying pan|fry pan|skillet|saute pan|sauté pan|pan|tadka pan)\b/i],
  ['pot', /\b(pot|saucepan|sauce pan|vessel|handi|deg|patila|dutch oven|stock ?pot)\b/i],
  ['bowl', /\b(bowl)\b/i],
];
const VESSEL_LABEL = { cooker: 'Cooker', kadai: 'Kadai', tawa: 'Tawa', oven: 'Oven', pan: 'Pan', pot: 'Pot', bowl: 'Bowl' };
const HEAT_WORDS = /\b(heat|cook|boil|simmer|fry|saut[eé]|roast|toast|temper|bake|stir|add|pour|bring|steam|pressure)\b/i;
const PREP_WORDS = /^(wash|rinse|soak|chop|dice|slice|mince|grate|peel|cut|marinate|mix|whisk|knead|measure|keep ready|prepare)\b/i;
const FAST_WORDS = /\b(tadka|tempering|temper|splutter|crackle|immediately|quickly|right away|straight away|don'?t let (it )?burn|within seconds|caramel)\b/i;

function parseNumber(token) {
  if (!token) return null;
  const t = token.trim();
  if (FRACTION_CHARS[t] != null) return FRACTION_CHARS[t];
  let m = t.match(/^(\d+)\s*([½¼¾⅓⅔⅛])$/);
  if (m) return Number(m[1]) + FRACTION_CHARS[m[2]];
  m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = t.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  m = t.match(/^\d+(?:\.\d+)?$/);
  if (m) return Number(t);
  return null;
}

const QTY_RE = /(\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔⅛]|\d+\/\d+|\d+(?:\.\d+)?|[½¼¾⅓⅔⅛])(?:\s*(?:-|–|to)\s*(?:\d+(?:\.\d+)?|\d+\/\d+))?/;

function unitOf(word) {
  for (const [u, re] of UNIT_WORDS) if (re.test(word)) return u;
  return null;
}

function cleanLine(line) {
  return line.replace(/^\s*(?:[-*•▪◦·]|\d+[.)]|step\s*\d+[:.)-]?|\(\d+\))\s*/i, '').replace(/\*\*|__|`/g, '').replace(/^#+\s*/, '').trim();
}

// "1 cup toor dal, rinsed", "Toor dal – 1 cup", "Salt to taste", "2-3 green chillies (slit)"
export function parseIngredient(line) {
  let text = cleanLine(line).replace(/\s+/g, ' ');
  if (!text || text.length > 140) return null;
  let note = '';
  text = text.replace(/\(([^)]*)\)/g, (_, n) => { note = note || n; return ''; }).replace(/\s+/g, ' ').trim();
  let qty = null;
  let unit = '';
  let name = text;
  let m = text.match(new RegExp(`^${QTY_RE.source}\\s*([A-Za-z.]+)?\\s+(?:of\\s+)?(.+)$`));
  if (m) {
    qty = parseNumber(m[1]);
    const u = m[2] ? unitOf(m[2]) : null;
    if (u) { unit = u; name = m[3]; } else { name = `${m[2] ? `${m[2]} ` : ''}${m[3]}`; }
  } else {
    // "Name – 1 cup" or "Name: 2 tsp" (common in Indian recipe blogs)
    m = text.match(new RegExp(`^(.+?)\\s*(?:-|–|—|:)\\s*${QTY_RE.source}\\s*([A-Za-z.]+)?(.*)$`));
    if (m) {
      name = m[1];
      qty = parseNumber(m[2]);
      const u = m[3] ? unitOf(m[3]) : null;
      if (u) unit = u; else if (m[3]) note = note || m[3];
    }
  }
  name = name.split(/,| - | – /)[0].replace(/\b(to taste|as needed|as required|optional|for garnish(ing)?)\b/gi, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 50) return null;
  if (/to taste|as needed|as required/i.test(text) && qty == null) unit = 'to taste';
  let kind = 'fixed';
  if (qty != null) kind = WEIGHT_UNITS.has(unit) ? 'weight' : VOLUME_UNITS.has(unit) ? 'volume' : 'count';
  if (qty != null && kind === 'count' && unit && !['cloves', 'piece', 'handful', 'sprig', 'stick', 'leaf', 'pinch', 'inch'].includes(unit)) kind = 'fixed';
  const lower = name.toLowerCase();
  const aliases = [lower, ...(HINDI[lower] || []), ...Object.entries(HINDI).filter(([k]) => lower.includes(k) && k.length > 3).flatMap(([, v]) => v)];
  return { name: name.charAt(0).toUpperCase() + name.slice(1), qty, unit, kind, note: note.trim(), aliases: [...new Set(aliases)].slice(0, 5) };
}

function vesselIn(text) {
  for (const [v, re] of VESSEL_PATTERNS) if (re.test(text)) return v;
  return null;
}

// The stove view shows six to eight words; the full sentence stays in the detail line.
function shortHeadline(sentence) {
  let h = sentence.replace(/\s+/g, ' ').trim().replace(/[.:;!]$/, '');
  h = h.split(/[.;:!]\s/)[0];
  // "Once the pressure releases, open the cooker": the action is after the comma.
  const lead = h.match(/^(?:once|when|after|meanwhile|while|if|now|then|in the meantime)\b[^,]*,\s*(.+)$/i);
  if (lead && lead[1].split(' ').length >= 2) h = lead[1];
  h = h.split(/,\s/)[0].split(' ').length >= 3 ? h.split(/,\s/)[0] : h;
  if (h.split(' ').length > 8) {
    for (const brk of [' and ', ' with ', ' for ', ' on ', ' in ']) {
      const i = h.indexOf(brk);
      if (i > 0 && h.slice(0, i).split(' ').length >= 3) { h = h.slice(0, i); break; }
    }
  }
  const words = h.split(' ');
  if (words.length > 8) h = `${words.slice(0, 7).join(' ')}…`;
  return h.charAt(0).toUpperCase() + h.slice(1);
}

// A soak or marinade has no pot of its own; its timer goes on the pot that later cooks the same ingredient.
function potForPrep(stepText, laterSteps, ingredientNames) {
  const t = stepText.toLowerCase();
  const mentioned = ingredientNames.filter((n) => t.includes(n));
  for (const s of laterSteps) {
    if (!s.pot) continue;
    if (mentioned.some((n) => s.text.includes(n))) return { pot: s.pot, label: mentioned[0] };
  }
  return null;
}

function timerIn(text) {
  const w = text.match(/(\d+)\s*(?:whistles?|seeti|siti)\b/i);
  if (w) return { kind: 'whistle', target: Number(w[1]) };
  const h = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*(?:hours?|hrs?)\b/i);
  if (h) return { kind: 'countdown', minutes: Number(h[1]) * 60 };
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(?:minutes?|mins?)\b/i);
  if (m) {
    const lo = Number(m[1]);
    // A range ("8 to 10 minutes") is a judgement call, so it becomes a check-in at the low end.
    return m[2] ? { kind: 'checkin', minutes: lo } : { kind: 'countdown', minutes: lo };
  }
  return null;
}

function cueIn(text) {
  const m = text.match(/\b(?:till|until|untill|or until)\s+([^.,;()]{3,60})/i);
  if (!m) return null;
  const words = m[1].trim().split(/\s+/).slice(0, 7).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function parseRecipeText(raw, { title: givenTitle, source } = {}) {
  const text = String(raw || '').replace(/\r/g, '').replace(/ /g, ' ');
  const lines = text.split('\n').map((l) => l.trim());
  let mode = null;
  let title = givenTitle || '';
  let servings = null;
  let totalMinutes = null;
  const ingLines = [];
  const stepLines = [];
  let group = null;
  const loose = [];

  for (const line of lines) {
    if (!line) continue;
    const plain = cleanLine(line).replace(/:$/, '');
    // Chatbot answers open with "Sure! Here's a simple Rajma Chawal recipe for 4 people."
    const pre = !title && !mode && plain.match(/here(?:'|’)?s\s+(?:an?\s+)?(?:(?:simple|easy|quick|classic|delicious|tasty|traditional|homestyle|authentic)\s+)*(.+?)\s+recipe\b/i);
    if (pre) { title = pre[1].replace(/^(?:a|an|the)\s+/i, ''); }
    const serv = line.match(/\b(?:serves|servings|yield|makes)\s*:?\s*(\d+)|(\d+)\s*(?:servings|people|persons|portions)\b/i);
    if (serv && line.length < 60) { servings = Number(serv[1] || serv[2]); continue; }
    const tot = line.match(/\btotal(?:\s+time)?\s*:?\s*(?:(\d+)\s*h(?:ours?|rs?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?|ins?)?)?/i);
    if (tot && (tot[1] || tot[2]) && line.length < 50) { totalMinutes = Number(tot[1] || 0) * 60 + Number(tot[2] || 0); continue; }
    if (/^(#+\s*)?(\*\*)?\s*(ingredients?|you('| wi)ll need|what you need|things you need|samagri)\b/i.test(line) && plain.length < 40) { mode = 'ing'; group = null; continue; }
    if (/^(#+\s*)?(\*\*)?\s*(method|instructions?|steps?|directions?|how to (make|cook)|preparation|procedure|vidhi|recipe steps)\b/i.test(line) && plain.length < 40) { mode = 'steps'; continue; }
    if (/^(#+\s*)?(\*\*)?\s*(notes?|tips?|serving suggestions?|nutrition|faq)\b/i.test(line) && plain.length < 40) { mode = 'skip'; continue; }
    if (!title && !mode && plain.length > 2 && plain.length < 80 && !/^\d/.test(plain)) { title = plain.replace(/\s*recipe$/i, ''); continue; }
    if (mode === 'ing') {
      // A sub-heading inside the list ("For the tadka:")
      if (/^(#+\s*)?(\*\*)?\s*for (the )?/i.test(line) && plain.length < 40 && !QTY_RE.test(plain)) { group = plain.replace(/^for (the )?/i, ''); continue; }
      ingLines.push({ line, group });
    } else if (mode === 'steps') {
      stepLines.push(line);
    } else if (mode !== 'skip') {
      loose.push(line);
    }
  }
  // No headings at all: numbered lines are steps, lines that start with a quantity are ingredients.
  if (!ingLines.length && !stepLines.length) {
    for (const line of loose) {
      if (/^\s*(\d+[.)]|step\s*\d+)/i.test(line) && line.length > 25) stepLines.push(line);
      else if (QTY_RE.test(line.slice(0, 6)) || /^[-*•]/.test(line)) ingLines.push({ line, group: null });
      else if (line.length > 40) stepLines.push(line);
    }
  }

  // Ingredients
  const ingredients = {};
  const groupsByKey = new Map();
  for (const { line, group: g } of ingLines) {
    const ing = parseIngredient(line);
    if (!ing) continue;
    let key = slug(ing.name);
    let n = 2;
    while (ingredients[key]) key = `${slug(ing.name)}${n++}`;
    const gk = g ? slug(g) : 'all';
    ingredients[key] = { name: ing.name, qty: ing.qty, unit: ing.unit, kind: ing.kind, group: gk, aliases: ing.aliases };
    if (!groupsByKey.has(gk)) groupsByKey.set(gk, { key: gk, title: g ? g.charAt(0).toUpperCase() + g.slice(1) : 'Ingredients', sub: '', lane: null, ids: [] });
    groupsByKey.get(gk).ids.push(key);
  }

  // Steps: a long paragraph without numbers is split into sentences, two per step.
  let rawSteps = stepLines.map(cleanLine).filter((s) => s.length > 3);
  if (rawSteps.length === 1 && rawSteps[0].length > 200) {
    const sentences = rawSteps[0].match(/[^.!?]+[.!?]+/g) || [rawSteps[0]];
    rawSteps = [];
    for (let i = 0; i < sentences.length; i += 2) rawSteps.push(sentences.slice(i, i + 2).join(' ').trim());
  }

  // Pots: the vessels named most often, up to three, in the order they first appear.
  const counts = new Map();
  const firstSeen = new Map();
  rawSteps.forEach((s, i) => { const v = vesselIn(s); if (v && v !== 'bowl') { counts.set(v, (counts.get(v) || 0) + 1); if (!firstSeen.has(v)) firstSeen.set(v, i); } });
  let vessels = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a)).slice(0, 3).sort((a, b) => firstSeen.get(a) - firstSeen.get(b));
  if (!vessels.length) vessels = ['pot'];
  const pots = vessels.map((v) => ({ id: v, name: VESSEL_LABEL[v], vessel: VESSELS.includes(v) ? v : 'pot' }));

  const ingredientNames = Object.values(ingredients).map((i) => i.name.toLowerCase().split(' ').pop()).filter((n) => n.length > 2);
  const potGuess = rawSteps.map((s) => { const v = vesselIn(s); return { text: s.toLowerCase(), pot: v && vessels.includes(v) ? v : null }; });
  const steps = [];
  let lastPot = null;
  const whistlePots = new Set();
  for (const s of rawSteps.slice(0, 30)) {
    const v = vesselIn(s);
    let pot = v && vessels.includes(v) ? v : null;
    if (!pot && !PREP_WORDS.test(s) && HEAT_WORDS.test(s)) pot = lastPot || pots[0].id;
    if (pot) lastPot = pot;
    const timer = timerIn(s);
    const cue = cueIn(s);
    const st = { place: pot ? VESSEL_LABEL[pot] : (/\b(soak|rinse|wash)\b/i.test(s) ? 'Sink' : 'Counter'), pot, headline: shortHeadline(s), detail: s.length > 260 ? `${s.slice(0, 257)}…` : s };
    if (cue) st.cue = { kind: 'text', text: cue };
    if (FAST_WORDS.test(s)) st.fast = true;
    if (timer) {
      const prep = !pot ? potForPrep(s, potGuess.slice(steps.length + 1), ingredientNames) : null;
      const slot = pot || (prep && prep.pot) || lastPot || pots[0].id;
      const name = prep ? prep.label.charAt(0).toUpperCase() + prep.label.slice(1) : pots.find((p) => p.id === slot).name;
      if (timer.kind === 'whistle') {
        st.onEnter = [{ slot, type: 'whistle', label: name, sub: `${name.toLowerCase()} · listening for whistles`, target: timer.target }];
        whistlePots.add(slot);
      } else if (timer.kind === 'checkin') {
        st.onEnter = [{ slot, type: 'checkin', label: name, sub: `${name.toLowerCase()} · ${cue ? cue.toLowerCase() : 'check it'}`, ask: cue ? `${cue}?` : 'Ready?', minutes: timer.minutes }];
      } else {
        st.onEnter = [{ slot, type: 'countdown', label: name, sub: `${name.toLowerCase()} · ${timer.minutes} min`, minutes: timer.minutes }];
      }
    }
    // After the whistles, a step that opens the cooker waits until it is safe.
    if (pot && whistlePots.has(pot) && !(st.onEnter || []).some((t) => t.type === 'whistle') && /\b(open|mash|once the pressure|after the pressure|release)\b/i.test(s)) st.waitFor = pot;
    steps.push(st);
  }

  const chips = [];
  if (totalMinutes) chips.push(`About ${totalMinutes} min`);
  chips.push(pots.length === 1 ? 'One pot' : `${pots.length} pots at once`);
  if (vessels.includes('cooker')) chips.push('Pressure cooker');

  return {
    title: title || 'Pasted recipe',
    source: source || { kind: 'text' },
    baseServings: servings || 2,
    chips,
    pots,
    ingredients,
    groups: [...groupsByKey.values()],
    steps,
    tips: whistlePots.size ? [{ kind: 'whistles' }] : [],
  };
}
