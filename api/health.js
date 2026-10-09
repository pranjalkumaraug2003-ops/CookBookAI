// GET /api/health -> { ok, ai } : lets the app say whether imports will use AI or simple rules.
export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ ok: true, ai: !!process.env.GEMINI_API_KEY, needsCode: !!process.env.IMPORT_CODE }));
}
