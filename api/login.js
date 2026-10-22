import { OAuth2Client } from 'google-auth-library';
import { json, readJson } from '../lib/http.js';
import { authConfigured, googleClientId, isAllowed, sessionCookie } from '../lib/auth.js';
import { clientIp, lockedFor, recordFail, clearFails } from '../lib/ratelimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!authConfigured()) return json(res, 503, { error: 'Google sign-in is not configured on the server.' });
  const ip = clientIp(req);
  const wait = await lockedFor(ip);
  if (wait) return json(res, 429, { error: 'Too many attempts. Try again later.' }, { 'Retry-After': String(wait) });
  let body;
  try { body = await readJson(req, 16 * 1024); } catch (e) { return json(res, 400, { error: 'Bad request' }); }

  let payload;
  try {
    const ticket = await new OAuth2Client(googleClientId()).verifyIdToken({ idToken: String(body?.credential || ''), audience: googleClientId() });
    payload = ticket.getPayload();
  } catch (e) {
    await recordFail(ip);
    return json(res, 401, { error: 'Could not verify that Google account.' });
  }
  const email = String(payload?.email || '').toLowerCase();
  if (!payload?.email_verified || !isAllowed(email)) {
    await recordFail(ip);
    return json(res, 403, { error: 'This Google account is not authorised.' });
  }
  await clearFails(ip);
  json(res, 200, { ok: true, email, name: payload.name || '' }, { 'Set-Cookie': sessionCookie(req, { email, name: payload.name }) });
}
