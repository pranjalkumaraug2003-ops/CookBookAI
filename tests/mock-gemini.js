// Stands in for Gemini's generateContent during tests. It answers with fixed drafts in Gemini's response
// format, so the server's real request, parsing and repair code all run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const calls = [];

export default async function mock(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  calls.push(body);
  const parts = body.contents?.[0]?.parts || [];
  const isVideo = parts.some((p) => p.fileData);
  const text = parts.map((p) => p.text || '').join('\n');
  res.setHeader('content-type', 'application/json');
  if (!req.headers['x-goog-api-key']) { res.statusCode = 403; return res.end(JSON.stringify({ error: { message: 'no key', status: 'PERMISSION_DENIED' } })); }
  // SCHEMA_REJECTED: behave like a model that rejects responseSchema but accepts responseJsonSchema.
  if (/SCHEMA_REJECTED/.test(text) && body.generationConfig?.responseSchema) { res.statusCode = 400; return res.end(JSON.stringify({ error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } })); }
  if (!body.generationConfig?.responseSchema && !body.generationConfig?.responseJsonSchema) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: 'test expects a schema' } })); }
  // QUOTA_FIRST: the first model is out of quota, the next one answers.
  if (/QUOTA_FIRST/.test(text) && /3\.8/.test(req.url)) { res.statusCode = 429; return res.end(JSON.stringify({ error: { message: 'quota exceeded', status: 'RESOURCE_EXHAUSTED' } })); }
  if (/MODEL_FAILS/.test(text)) { res.statusCode = 503; return res.end(JSON.stringify({ error: { message: 'overloaded', status: 'UNAVAILABLE' } })); }
  const file = isVideo ? 'gemini-video.json' : 'gemini-text.json';
  const draft = fs.readFileSync(path.join(dir, file), 'utf8');
  res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: draft }] }, finishReason: 'STOP' }] }));
}
