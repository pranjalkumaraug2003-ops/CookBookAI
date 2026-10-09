// POST /api/import  { input: "<a link or the recipe text>" }
// -> 200 { recipe, warnings, method }   or   4xx/5xx { error, code }
//
// Order of trust: the page's structured recipe data first, a language model second (to map steps to pots,
// timers and cues), simple rules when the model is unavailable, and the cook's own review last of all.
import { fetchPage, extractRecipe, pageMeta, pageText, recipeToText, UserError } from './_lib/page.js';
import { draftWithGemini } from './_lib/gemini.js';
import { draftToRecipe } from './_lib/convert.js';
import { parseRecipeText } from '../parse-text.js';
import { normalizeRecipe } from '../recipe.js';

export const config = { maxDuration: 60 };

const YT = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/;

// A small per-address limit. Serverless instances don't share memory, so this is a speed bump, not a wall;
// the real cap on cost is the API key's own quota.
const hits = new Map();
function limited(ip) {
  const t = Date.now();
  const list = (hits.get(ip) || []).filter((x) => t - x < 10 * 60 * 1000);
  list.push(t);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > Number(process.env.IMPORT_LIMIT || 12);
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 100_000) throw new UserError('That is too much text. Paste just the recipe.', 'too_big', 413); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function youtubeMeta(url) {
  // oEmbed tells us the title and channel, and fails for private or removed videos.
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
    if (r.status === 401 || r.status === 403) throw new UserError('That video is private or does not allow embedding.', 'video_private');
    if (r.status === 404 || r.status === 400) throw new UserError('That video could not be found.', 'video_missing', 404);
    if (!r.ok) return {};
    const j = await r.json();
    return { title: j.title || '', author: j.author_name || '' };
  } catch (e) {
    if (e instanceof UserError) throw e;
    return {};
  }
}

// Text through the model if there is one, through the rules if not (or if the model fails).
async function fromText(text, source, warnings, { structured = false } = {}) {
  try {
    const { draft, model, format } = await draftWithGemini({ text });
    return { recipe: draftToRecipe(draft, { source, warnings }), method: `${structured ? 'recipe card + ' : ''}${model}${format !== 'schema' ? ` (${format})` : ''}` };
  } catch (e) {
    if (e.code !== 'NO_KEY') warnings.push(`The AI step failed (${e.message}${e.details ? `: ${String(e.details).slice(0, 160)}` : ''}), so simple rules made this draft. Check pots and timers carefully.`);
    else warnings.push('Made with simple rules, not AI. Check pots and timers carefully.');
    const draft = parseRecipeText(text, { source });
    return { recipe: normalizeRecipe({ ...draft, source }, { warnings }), method: structured ? 'recipe card + rules' : 'rules' };
  }
}

export async function importRecipe(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new UserError('Paste a link or a recipe first.', 'empty');
  if (raw.length > 40000) throw new UserError('That is too much text. Paste just the recipe.', 'too_big', 413);
  const warnings = [];
  const isUrl = /^https?:\/\/\S+$/i.test(raw);

  if (isUrl && YT.test(raw)) {
    const videoId = raw.match(YT)[1];
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const meta = await youtubeMeta(url);
    const source = { kind: 'youtube', url, videoId, author: meta.author || '' };
    try {
      const { draft, model, format } = await draftWithGemini({ youtubeUrl: url, title: meta.title });
      const recipe = draftToRecipe(draft, { source, warnings });
      if (!recipe.steps.some((s) => s.video)) warnings.push('The steps have no video times, so the video will play straight through. You can add times on each step.');
      return { recipe, warnings, method: `video + ${model}${format !== 'schema' ? ` (${format})` : ''}` };
    } catch (e) {
      if (e.code === 'NO_KEY') throw new UserError('Reading a video needs the AI model, which is not set up on this server. Paste the recipe text from the video description instead.', 'needs_model', 501);
      if (e instanceof UserError) throw e;
      if (e.status === 429) throw new UserError('The AI model has reached its free limit for now. Try again in a minute, or paste the recipe text from the video description.', 'model_quota', 429);
      throw new UserError(`The video could not be read (${e.message}). Paste the recipe text from its description instead.`, 'model_failed', 502);
    }
  }

  if (isUrl) {
    const page = await fetchPage(raw);
    const meta = pageMeta(page.html, page.url);
    const card = extractRecipe(page.html);
    const source = { kind: 'blog', url: page.url, site: meta.site, author: card && card.author ? card.author : '' };
    if (card) {
      const out = await fromText(recipeToText(card), source, warnings, { structured: true });
      if (card.name) out.recipe.title = card.name.slice(0, 80);
      return { ...out, warnings };
    }
    const text = pageText(page.html);
    if (text.length < 200) throw new UserError('No recipe was found on that page. Paste the recipe text instead.', 'no_recipe', 422);
    warnings.push('This page has no recipe card, so the steps were read from its text.');
    const out = await fromText(`${meta.title}\n\n${text}`, source, warnings);
    return { ...out, warnings };
  }

  const out = await fromText(raw, { kind: 'text' }, warnings);
  return { ...out, warnings };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('allow', 'POST'); return send(res, 204, {}); }
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.', code: 'method' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'Too many imports in a few minutes. Try again shortly.', code: 'rate_limited' });
  if (process.env.IMPORT_CODE && req.headers['x-import-code'] !== process.env.IMPORT_CODE) return send(res, 401, { error: 'This server needs an access code for imports.', code: 'needs_code' });
  try {
    const body = await readJson(req);
    const out = await importRecipe(body.input);
    return send(res, 200, out);
  } catch (e) {
    if (e instanceof UserError) return send(res, e.status || 400, { error: e.message, code: e.code });
    if (e instanceof SyntaxError) return send(res, 400, { error: 'The request was not valid JSON.', code: 'bad_json' });
    console.error('import failed', e);
    return send(res, 500, { error: 'Something went wrong on the server.', code: 'server' });
  }
}
