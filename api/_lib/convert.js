// Turns the model's draft into a Cook-Along recipe and repairs what the model got wrong:
// unknown pots, placeholders that name no ingredient, impossible timers, out-of-order video times.
// Every repair is listed in `warnings` so the review screen can point the cook at it.
import { normalizeRecipe, slug, VESSEL_NAMES } from '../../recipe.js';

const plainText = (s) => String(s || '').replace(/\{\w+\}\s*/g, '').replace(/\s+/g, ' ').trim();
const clampWords = (s, n) => { const w = String(s || '').trim().split(/\s+/); return w.length > n ? `${w.slice(0, n).join(' ')}…` : w.join(' '); };

export function draftToRecipe(draft, { source, warnings = [] } = {}) {
  const d = draft || {};
  const pots = (Array.isArray(d.pots) ? d.pots : []).slice(0, 3).map((p, i) => ({ id: slug(p.key || p.name || `pot${i + 1}`), name: String(p.name || `Pot ${i + 1}`).slice(0, 24), vessel: p.vessel || 'pot' }));
  if (!pots.length) pots.push({ id: 'pot', name: 'Pot', vessel: 'pot' });
  if (Array.isArray(d.pots) && d.pots.length > 3) warnings.push(`The recipe uses ${d.pots.length} vessels; only 3 fit on the timer rail.`);
  const potIds = new Set(pots.map((p) => p.id));
  const potFor = (k) => { if (k == null) return null; const id = slug(k); return potIds.has(id) ? id : null; };
  const potName = (id) => (pots.find((p) => p.id === id) || pots[0]).name;
  const vessel = (id) => VESSEL_NAMES[(pots.find((p) => p.id === id) || pots[0]).vessel] || 'pot';

  // Ingredients, keyed by the model's keys (slugged), plus a lookup by name for repairs.
  const ingredients = {};
  const keyMap = new Map();
  for (const ing of Array.isArray(d.ingredients) ? d.ingredients : []) {
    if (!ing || !ing.name) continue;
    let key = slug(ing.key || ing.name);
    let n = 2;
    while (ingredients[key]) key = `${slug(ing.key || ing.name)}${n++}`;
    keyMap.set(String(ing.key || ''), key);
    keyMap.set(slug(ing.key || ''), key);
    const kind = ['volume', 'count', 'weight', 'fixed'].includes(ing.kind) ? ing.kind : 'fixed';
    ingredients[key] = {
      name: String(ing.name).slice(0, 40),
      qty: typeof ing.qty === 'number' && ing.qty > 0 ? ing.qty : null,
      unit: String(ing.unit || (ing.qty == null ? 'to taste' : '')).slice(0, 16),
      kind: typeof ing.qty === 'number' ? kind : 'fixed',
      group: potFor(ing.group) || (ing.group === 'finish' ? 'finish' : 'prep'),
      aliases: [...new Set([String(ing.name).toLowerCase(), ...(Array.isArray(ing.aliases) ? ing.aliases.map((a) => String(a).toLowerCase()) : [])])].slice(0, 6),
    };
  }
  const byName = (word) => Object.entries(ingredients).find(([, v]) => v.name.toLowerCase() === word.toLowerCase() || v.aliases.includes(word.toLowerCase()));
  let badPlaceholders = 0;
  const lowerKeys = new Map(Object.keys(ingredients).map((k) => [k.toLowerCase(), k]));
  // Placeholders the model gets wrong: {whistles} or {minutes} (the step's own numbers), a key in the wrong
  // case, or an ingredient's name instead of its key.
  const fixText = (t, step = {}) => String(t || '').replace(/\{([^{}]{1,40})\}/g, (m, k) => {
    if (ingredients[k]) return m;
    if (/^(whistles?|count)$/i.test(k) && Number.isInteger(step.whistles)) return String(step.whistles);
    if (/^(minutes?|mins?|time)$/i.test(k) && typeof step.minutes === 'number') return String(step.minutes);
    if (keyMap.has(k)) return `{${keyMap.get(k)}}`;
    if (lowerKeys.has(k.toLowerCase())) return `{${lowerKeys.get(k.toLowerCase())}}`;
    const hit = byName(k) || byName(k.replace(/([a-z])([A-Z])/g, '$1 $2'));
    if (hit) return `{${hit[0]}}`;
    badPlaceholders++;
    return k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  });

  const steps = [];
  const whistled = new Set();
  let lastVideo = -1;
  let videoBroken = false;
  for (const s of Array.isArray(d.steps) ? d.steps : []) {
    if (!s || !s.headline) continue;
    const pot = potFor(s.pot);
    const headline = clampWords(fixText(s.headline, s), 9);
    const st = { place: String(s.place || (pot ? potName(pot) : 'Counter')).slice(0, 24), pot, headline, detail: fixText(s.detail, s).slice(0, 260) };
    if (s.cue) st.cue = { kind: 'text', text: clampWords(s.cue, 8) };
    if (Array.isArray(s.checklist) && s.checklist.length > 1) st.checklist = s.checklist.slice(0, 6).map((c) => clampWords(fixText(c, s), 7));
    if (s.cannotPause) st.fast = true;
    const slot = pot || null;
    const label = slot ? potName(slot) : 'Timer';
    if (s.timerKind === 'whistles') {
      const target = Number.isInteger(s.whistles) && s.whistles > 0 && s.whistles <= 12 ? s.whistles : null;
      if (!slot) warnings.push(`“${headline}” counts whistles but has no pot; pick the cooker.`);
      else if (!target) warnings.push(`“${headline}” needs a whistle count; the source did not give one.`);
      if (slot) {
        st.onEnter = [{ slot, type: 'whistle', label, sub: `${vessel(slot)} · listening for whistles`, target: target || 3 }];
        whistled.add(slot);
      }
    } else if ((s.timerKind === 'countdown' || s.timerKind === 'checkin') && slot) {
      const minutes = typeof s.minutes === 'number' && s.minutes > 0 && s.minutes <= 240 ? s.minutes : null;
      if (!minutes) warnings.push(`“${headline}” has a timer without a time; set one or remove it.`);
      else if (s.timerKind === 'checkin') {
        st.onEnter = [{ slot, type: 'checkin', label, sub: `${vessel(slot)} · ${s.cue ? clampWords(s.cue, 4).toLowerCase() : 'check it'}`, ask: s.cue ? `${clampWords(s.cue, 6)}?` : 'Ready?', minutes }];
      } else {
        const t = { slot, type: 'countdown', label, sub: `${vessel(slot)} · ${clampWords(plainText(headline), 4).toLowerCase()}`, minutes };
        if (s.whenDone) t.then = { alert: { kicker: `${label} · ${vessel(slot)}`, sub: 'Timer done', title: clampWords(s.whenDone, 5), body: s.cue ? `Check: ${clampWords(s.cue, 8).toLowerCase()}.` : '' } };
        else t.then = { doneText: 'Done', notify: { text: `${label}: time is up`, sub: s.cue ? `Check: ${clampWords(s.cue, 8).toLowerCase()}.` : '' } };
        st.onEnter = [t];
      }
    } else if ((s.timerKind === 'countdown' || s.timerKind === 'checkin') && !slot) {
      warnings.push(`“${headline}” has a timer but no pot; it was left off.`);
    }
    const wait = potFor(s.waitsForPot);
    if (wait && whistled.has(wait)) st.waitFor = wait;
    if (source && source.kind === 'youtube' && typeof s.videoStart === 'number') {
      if (s.videoStart < lastVideo) videoBroken = true;
      lastVideo = s.videoStart;
      st.video = { start: Math.max(0, s.videoStart), end: typeof s.videoEnd === 'number' && s.videoEnd > s.videoStart ? s.videoEnd : null };
    }
    steps.push(st);
  }
  if (videoBroken) { warnings.push('The video times were out of order, so steps will not jump around the video.'); steps.forEach((s) => delete s.video); }
  if (badPlaceholders) warnings.push(`${badPlaceholders} amount${badPlaceholders > 1 ? 's' : ''} in the steps did not match an ingredient and will not rescale.`);
  for (const p of Array.isArray(d.problems) ? d.problems.slice(0, 4) : []) if (p) warnings.push(String(p).slice(0, 140));

  // Ingredient cards: one per pot, then prep and finish.
  const groups = [];
  for (const p of pots) {
    const ids = Object.keys(ingredients).filter((k) => ingredients[k].group === p.id);
    if (ids.length) groups.push({ key: p.id, title: p.name, sub: VESSEL_NAMES[p.vessel] || p.vessel, lane: p.id, ids });
  }
  const prep = Object.keys(ingredients).filter((k) => ingredients[k].group === 'prep');
  if (prep.length) groups.push({ key: 'prep', title: 'Prep', sub: 'counter', lane: null, ids: prep });
  const fin = Object.keys(ingredients).filter((k) => ingredients[k].group === 'finish');
  if (fin.length) groups.push({ key: 'finish', title: 'To finish', sub: '', lane: null, ids: fin });

  const chips = [];
  if (typeof d.totalMinutes === 'number' && d.totalMinutes > 0) chips.push(`About ${Math.round(d.totalMinutes)} min`);
  chips.push(pots.length === 1 ? 'One pot' : `${pots.length} pots at once`);
  if (pots.some((p) => p.vessel === 'cooker')) chips.push('Pressure cooker');
  if (source && source.kind === 'youtube') chips.push('YouTube video');

  return normalizeRecipe({
    id: `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: String(d.title || 'Imported recipe').slice(0, 80),
    source,
    baseServings: Number.isInteger(d.servings) && d.servings > 0 ? d.servings : 2,
    chips,
    pots,
    ingredients,
    groups,
    steps,
    tips: whistled.size ? [{ kind: 'whistles' }] : [],
    doneLine: d.servingLine || '',
  }, { warnings });
}
