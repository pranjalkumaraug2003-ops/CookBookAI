// Fetches a recipe page on the server and reads it.
// Most recipe blogs publish a machine-readable recipe (schema.org Recipe as JSON-LD, which recipe-card plugins
// such as WP Recipe Maker write for Google). That is read first; the page's visible text is the fallback.
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 2_500_000;
const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------- SSRF guard
// The server fetches a URL a stranger typed, so it must never be pointed at itself or a private network.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  return true;
}

export async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch (_) { throw new UserError('That link does not look right.', 'bad_url'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UserError('Only http and https links can be read.', 'bad_url');
  if (url.username || url.password) throw new UserError('Links with a username or password are not supported.', 'bad_url');
  if (process.env.ALLOW_PRIVATE_FETCH === '1') return url; // local tests only
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new UserError('That address is not on the public web.', 'bad_url');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new UserError('That website could not be found.', 'not_found'); });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new UserError('That address is not on the public web.', 'bad_url');
  return url;
}

export class UserError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}

// Redirects are followed by hand so every hop passes the same check.
export async function fetchPage(raw) {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; CookAlongBot/1.0; reads one recipe page when a cook pastes its link)', accept: 'text/html,application/xhtml+xml' },
      });
    } catch (e) {
      clearTimeout(timer);
      throw new UserError(e.name === 'AbortError' ? 'The page took too long to load.' : 'The page could not be reached.', 'unreachable', 502);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      url = await assertPublicUrl(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    if (!res.ok) { clearTimeout(timer); throw new UserError(`The page answered with an error (${res.status}).`, 'http_error', 502); }
    const type = res.headers.get('content-type') || '';
    if (!/html|xml|text\/plain/i.test(type)) { clearTimeout(timer); throw new UserError('That link is not a web page.', 'not_html'); }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { ctl.abort(); break; }
      chunks.push(value);
    }
    clearTimeout(timer);
    return { url: url.toString(), html: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8') };
  }
  throw new UserError('The page redirected too many times.', 'redirects', 502);
}

// ---------------------------------------------------------------- reading the page
const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&frac12;/g, '½').replace(/&frac14;/g, '¼').replace(/&frac34;/g, '¾');
const stripTags = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function isRecipe(node) {
  const t = node && node['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}

function findRecipe(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n, depth + 1); if (r) return r; } return null; }
  if (typeof node !== 'object') return null;
  if (isRecipe(node)) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    const r = findRecipe(node[key], depth + 1);
    if (r) return r;
  }
  return null;
}

// ISO 8601 durations: PT1H30M
export function isoMinutes(d) {
  const m = String(d || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const mins = Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  return mins || null;
}

function instructionLines(ins, out = [], section = '') {
  if (!ins) return out;
  if (typeof ins === 'string') { stripTags(ins).split(/\n|(?<=\.)\s{2,}/).map((s) => s.trim()).filter(Boolean).forEach((s) => out.push(s)); return out; }
  if (Array.isArray(ins)) { ins.forEach((x) => instructionLines(x, out, section)); return out; }
  if (typeof ins === 'object') {
    if (ins['@type'] === 'HowToSection' || ins.itemListElement) {
      const name = stripTags(ins.name || '');
      instructionLines(ins.itemListElement || [], out, name);
      return out;
    }
    const text = stripTags(ins.text || ins.name || '');
    if (text) out.push(text);
  }
  return out;
}

const youtubeIdFrom = (u) => { const m = String(u || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/); return m ? m[1] : null; };

export function extractRecipe(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b.trim()); } catch (_) {
      try { data = JSON.parse(b.trim().replace(/,\s*([}\]])/g, '$1')); } catch (__) { continue; }
    }
    const r = findRecipe(data);
    if (!r) continue;
    const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : r.ingredients || []).map(stripTags).filter(Boolean);
    const steps = instructionLines(r.recipeInstructions);
    if (!ingredients.length && !steps.length) continue;
    const yieldRaw = Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield;
    const servings = Number(String(yieldRaw || '').match(/\d+/)?.[0]) || null;
    const video = Array.isArray(r.video) ? r.video[0] : r.video;
    return {
      name: stripTags(r.name),
      servings,
      totalMinutes: isoMinutes(r.totalTime) || ((isoMinutes(r.prepTime) || 0) + (isoMinutes(r.cookTime) || 0)) || null,
      ingredients,
      steps,
      videoId: video ? youtubeIdFrom(video.embedUrl || video.contentUrl || video.url) : null,
      author: stripTags(Array.isArray(r.author) ? r.author[0]?.name : r.author?.name || r.author || ''),
    };
  }
  return null;
}

export function pageMeta(html, url) {
  const meta = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'));
    return m ? decode(m[1]).trim() : '';
  };
  const title = meta('og:title') || stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  let site = meta('og:site_name');
  try { site = site || new URL(url).hostname.replace(/^www\./, ''); } catch (_) { /* ignore */ }
  return { title, site };
}

// The page's readable text: the article if there is one, without scripts, menus and footers.
export function pageText(html) {
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ');
  const main = h.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
  if (main && main[2].length > 1500) h = main[2];
  h = h.replace(/<\/(p|div|li|h[1-6]|tr|br|section)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ');
  return decode(h.replace(/<[^>]+>/g, ' ')).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1).join('\n').slice(0, 30000);
}

// Structured data written out as a plain recipe, which both the model and the rule-based reader understand.
export function recipeToText(r) {
  return [
    r.name,
    r.servings ? `Serves ${r.servings}` : '',
    r.totalMinutes ? `Total time: ${r.totalMinutes} minutes` : '',
    '',
    'Ingredients',
    ...r.ingredients.map((i) => `- ${i}`),
    '',
    'Instructions',
    ...r.steps.map((s, i) => `${i + 1}. ${s}`),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}
