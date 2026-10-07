import { json, readJson } from '../lib/http.js';
import { authConfigured, checkPassword, sessionCookie } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!authConfigured()) return json(res, 503, { error: 'DASHBOARD_PASSWORD is not set on the server.' });
  let body;
  try { body = await readJson(req, 10 * 1024); } catch (e) { return json(res, 400, { error: 'Bad request' }); }
  if (!checkPassword(body?.password)) {
    await new Promise((r) => setTimeout(r, 700)); // slow down guessing
    return json(res, 401, { error: 'Wrong password' });
  }
  json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req) });
}
