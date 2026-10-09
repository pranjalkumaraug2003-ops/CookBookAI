// Starts the local server with the mock model, runs both browser suites, stops the server.
//   npm test            (needs: npm install, then npx playwright install chromium)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 8000 + Math.floor(Math.random() * 900) + 50;
const server = spawn(process.execPath, ['dev-server.js'], { cwd: root, env: { ...process.env, PORT: String(port), MOCK_GEMINI: '1' }, stdio: 'ignore' });
const run = (file, args) => new Promise((resolve) => { const p = spawn(process.execPath, [file, ...args], { cwd: root, stdio: 'inherit' }); p.on('exit', (code) => resolve(code)); });
await new Promise((r) => setTimeout(r, 1200));
let code = 0;
try {
  code ||= await run('tests/flow.cjs', ['tests/shots', `http://localhost:${port}/index.html?nosw`]);
  code ||= await run('tests/product.cjs', ['tests/shots', `http://localhost:${port}`]);
  code ||= await run('tests/tour.cjs', ['tests/shots', `http://localhost:${port}`]);
  code ||= await run('tests/phone.cjs', ['tests/shots', `http://localhost:${port}`]);
} finally {
  server.kill();
}
process.exit(code);
