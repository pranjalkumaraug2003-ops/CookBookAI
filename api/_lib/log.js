// One JSON line per event, so Vercel's log search can filter by field (event, status, code, kind, ms).
// What a cook pasted is never logged: only the kind of input, a link's host and a few counts.
const SILENT = process.env.NODE_ENV === 'test' || process.env.LOG_SILENT === '1';

export function log(event, fields = {}, level = 'info') {
  if (SILENT) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// What kind of input this was, without the input itself.
export function describeInput(raw) {
  const s = String(raw || '').trim();
  if (!/^https?:\/\/\S+$/i.test(s)) return { kind: 'text', chars: s.length };
  try {
    const host = new URL(s).hostname.replace(/^www\./, '');
    return { kind: /(^|\.)youtube\.com$|^youtu\.be$/.test(host) ? 'youtube' : 'link', host };
  } catch (_) {
    return { kind: 'link', host: 'invalid' };
  }
}

export function errorFields(e) {
  return {
    error: String(e && e.message || e).slice(0, 300),
    name: e && e.name,
    stack: e && e.stack ? String(e.stack).split('\n').slice(0, 6).join(' | ') : undefined,
  };
}
