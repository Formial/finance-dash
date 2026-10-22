import { json } from '../lib/http.js';
import { clearCookie } from '../lib/auth.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
}
