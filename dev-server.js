// Local server: serves the app and runs the /api functions the same way Vercel does.
//   node dev-server.js            -> http://localhost:8000
//   GEMINI_API_KEY=... node dev-server.js   to import with AI locally
// Tests start it with MOCK_GEMINI=1, which answers model calls from tests/fixtures instead of Google.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

let mock = null;
if (process.env.MOCK_GEMINI === '1') {
  mock = (await import('./tests/mock-gemini.js')).default;
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'mock';
  process.env.GEMINI_BASE_URL = `http://localhost:${port}/__mock/gemini`;
  process.env.ALLOW_PRIVATE_FETCH = '1';
  process.env.IMPORT_LIMIT = process.env.IMPORT_LIMIT || '100000'; // tests import many times from one address
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (mock && url.pathname.startsWith('/__mock/gemini/')) return mock(req, res, url);
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^\w-]/g, '');
      const file = path.join(root, 'api', `${name}.js`);
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{}'); }
      const mod = await import(`${file}?t=${fs.statSync(file).mtimeMs}`);
      return mod.default(req, res);
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
});
server.listen(port, () => console.log(`Cook-Along on http://localhost:${port}${mock ? ' (mock model)' : ''}`));
