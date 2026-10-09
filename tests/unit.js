// Unit checks for the parts that run without a browser: the rule-based reader, recipe validation,
// the page reader, the SSRF guard, the model-draft repairs and the schema conversion.
//   node tests/unit.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecipeText, parseIngredient } from '../parse-text.js';
import { normalizeRecipe, DAL_TADKA, fmtQty, scaledQty } from '../recipe.js';
import { extractRecipe, pageText, isoMinutes, assertPublicUrl, recipeToText } from '../api/_lib/page.js';
import { draftToRecipe } from '../api/_lib/convert.js';
import { toOpenApi, DRAFT_SCHEMA } from '../api/_lib/gemini.js';
import { parseCommand } from '../voice.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
const rejects = async (p) => { try { await p; return false; } catch (_) { return true; } };

// ---- ingredient lines in the shapes recipe sites and chatbots use
const ing = (l) => parseIngredient(l);
let x = ing('1 1/2 cups basmati rice, rinsed');
check('ingredient: mixed fraction + unit', x.qty === 1.5 && x.unit === 'cup' && x.name === 'Basmati rice' && x.kind === 'volume', x);
x = ing('Toor dal – 1 cup');
check('ingredient: "name – qty unit"', x.qty === 1 && x.unit === 'cup' && x.name === 'Toor dal', x);
x = ing('Salt to taste');
check('ingredient: to taste is fixed', x.qty === null && x.kind === 'fixed' && x.aliases.includes('namak'), x);
x = ing('½ tsp turmeric powder');
check('ingredient: unicode fraction, Hindi alias', x.qty === 0.5 && x.unit === 'tsp' && x.aliases.includes('haldi'), x);
x = ing('2-3 green chillies (slit)');
check('ingredient: a range takes the first number', x.qty === 2 && x.kind === 'count' && x.aliases.includes('hari mirch'), x);
x = ing('200 g paneer, cubed');
check('ingredient: grams scale as weight', x.qty === 200 && x.unit === 'g' && x.kind === 'weight', x);

// ---- the whole rule-based reader
const rajma = parseRecipeText(fs.readFileSync(path.join(dir, 'chatgpt-rajma.txt'), 'utf8'));
check('rules: title from a chatbot opening line', rajma.title === 'Rajma Chawal', rajma.title);
check('rules: servings', rajma.baseServings === 4, rajma.baseServings);
const r2 = parseRecipeText('Ingredients\n- 1 cup dal\nMethod\n1. Pressure cook the dal with water for 3 whistles.\n2. Heat ghee in a kadai and fry the onions.');
check('rules: "pressure cook" and whistles mean the cooker', r2.steps[0].pot === 'cooker' && r2.pots[0].vessel === 'cooker', r2.steps[0]);
check('rules: three pots, cooker first', rajma.pots.map((p) => p.vessel).join() === 'cooker,kadai,pot', rajma.pots);
const w = rajma.steps[0].onEnter && rajma.steps[0].onEnter[0];
check('rules: "6 whistles" becomes a whistle timer', w && w.type === 'whistle' && w.target === 6, w);
const soak = rajma.steps[1].onEnter[0];
check('rules: a soak timer goes on the pot that later cooks the rice', soak.slot === 'pot' && soak.minutes === 20, soak);
const golden = rajma.steps[3];
check('rules: "8-10 minutes until golden" is a check-in with a cue', golden.onEnter[0].type === 'checkin' && golden.onEnter[0].minutes === 8 && /golden/i.test(golden.cue.text), golden);
check('rules: opening the cooker waits for it', rajma.steps[6].waitFor === 'cooker', rajma.steps[6]);
check('rules: headline drops the "once…" clause', /^Open the cooker/.test(rajma.steps[6].headline), rajma.steps[6].headline);
check('rules: crackling seeds are a step that can\'t be paused', rajma.steps[2].fast === true);

// ---- validation repairs anything shaped wrong
const warnings = [];
const fixed = normalizeRecipe({ title: '  ', pots: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], steps: [{ headline: 'Go', pot: 'd', onEnter: [{ slot: 'd', type: 'countdown', minutes: 9999 }] }, { headline: '' }] }, { warnings });
check('validate: four pots become three, the fourth merged', fixed.pots.length === 3 && fixed.steps[0].pot === 'c' && warnings.some((m) => /3 pots/.test(m)), { pots: fixed.pots, w: warnings });
check('validate: timers are clamped', fixed.steps[0].onEnter[0].minutes === 240, fixed.steps[0].onEnter[0]);
check('validate: empty steps dropped, untitled named', fixed.steps.length === 1 && fixed.title === 'Untitled recipe');
check('validate: the built-in recipe passes unchanged in shape', normalizeRecipe(DAL_TADKA).steps.length === DAL_TADKA.steps.length);
check('scale: dal for 4 doubles', fmtQty(DAL_TADKA, 'toor', 4) === '1 cup' && scaledQty(DAL_TADKA, 'garlic', 6) === 12);

// ---- page reading
const html = fs.readFileSync(path.join(dir, 'blog.html'), 'utf8');
const card = extractRecipe(html);
check('page: finds a Recipe inside @graph', card && card.name === 'Jeera aloo' && card.ingredients.length === 5 && card.steps.length === 3, card);
check('page: yield, time and author', card.servings === 3 && card.totalMinutes === 25 && card.author === 'Asha', card);
const messy = '<script type="application/ld+json">{"@type":"Recipe","name":"Poha",\n"recipeIngredient":["1 cup poha"],"recipeInstructions":"Rinse the poha.\nTemper and mix.",}</script>';
check('page: a card with raw line breaks and a trailing comma still parses', extractRecipe(messy) && extractRecipe(messy).name === 'Poha', extractRecipe(messy));
check('page: ISO durations', isoMinutes('PT1H30M') === 90 && isoMinutes('PT45M') === 45 && isoMinutes('') === null);
check('page: structured data reads back as a plain recipe', /Ingredients\n- 3 potatoes/.test(recipeToText(card)));
check('page: text extraction skips scripts', !/schema\.org/.test(pageText(html)) && /Easy Jeera Aloo/.test(pageText(html)));

// ---- SSRF guard: never fetch our own machine or a private network
check('ssrf: localhost refused', await rejects(assertPublicUrl('http://localhost:8000/x')));
check('ssrf: private IPs refused', await rejects(assertPublicUrl('http://10.0.0.5/')) && await rejects(assertPublicUrl('http://192.168.1.1/')) && await rejects(assertPublicUrl('http://169.254.169.254/latest/meta-data')));
check('ssrf: IPv6 loopback refused', await rejects(assertPublicUrl('http://[::1]/')));
check('ssrf: other schemes refused', await rejects(assertPublicUrl('file:///etc/passwd')) && await rejects(assertPublicUrl('ftp://example.com/')));
check('ssrf: credentials in links refused', await rejects(assertPublicUrl('http://user:pw@example.com/')));

// ---- model drafts are repaired
const draft = JSON.parse(fs.readFileSync(path.join(dir, 'gemini-text.json'), 'utf8'));
const w2 = [];
const rec = draftToRecipe(draft, { source: { kind: 'text' }, warnings: w2 });
check('draft: unknown placeholders are turned into plain words and reported', !/\{unknownThing\}/.test(JSON.stringify(rec.steps)) && w2.some((m) => /did not match/.test(m)), w2);
check('draft: waits only for a pot that whistled', rec.steps[7].waitFor === 'rajma');
check('draft: "whenDone" becomes an alert', rec.steps[6].onEnter[0].then.alert.title === 'Turn the flame off');
check('draft: the source\'s own gaps are passed on', w2.some((m) => /salt/.test(m)));
const bad = JSON.parse(JSON.stringify(draft));
bad.steps[2].pot = 'nonsense';
bad.steps[3].timerKind = 'whistles'; bad.steps[3].whistles = null;
const w3 = [];
const rec3 = draftToRecipe(bad, { source: { kind: 'text' }, warnings: w3 });
check('draft: an unknown pot becomes "no pot"', rec3.steps[2].pot === null);
check('draft: a whistle step without a count is flagged', w3.some((m) => /whistle count/.test(m)), w3);
const vid = JSON.parse(fs.readFileSync(path.join(dir, 'gemini-video.json'), 'utf8'));
vid.steps[2].videoStart = 3;
const w4 = [];
const rec4 = draftToRecipe(vid, { source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' }, warnings: w4 });
check('draft: out-of-order video times are dropped, not trusted', rec4.steps.every((s) => !s.video) && w4.some((m) => /out of order/.test(m)), w4);

// ---- schema conversion for the API
const api = toOpenApi(DRAFT_SCHEMA);
check('schema: types upper-cased, nullables marked', api.type === 'OBJECT' && api.properties.totalMinutes.type === 'INTEGER' && api.properties.totalMinutes.nullable === true && api.properties.steps.items.properties.checklist.type === 'ARRAY');

// ---- the app never speaks a command: built-in recipe lines
const lines = DAL_TADKA.steps.flatMap((s) => [s.say || `${s.headline}. ${s.detail || ''}`, ...(s.beats || []).flatMap((b) => [b.say, b.sayHi])]);
check('voice: no built-in line parses as a command', lines.every((l) => !parseCommand(l.replace(/\{\w+\}/g, '2'))));

const failed = results.filter((r) => !r.ok);
console.log(results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.detail}]`}`).join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} unit checks passed`);
process.exit(failed.length ? 1 : 0);
