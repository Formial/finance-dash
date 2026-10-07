// Single shared-password gate. The deployed site is public, so every /api call
// that touches data needs the signed session cookie issued by /api/login.
// On Vercel with no DASHBOARD_PASSWORD set, everything stays locked (fail closed).
// A local run with no DASHBOARD_PASSWORD is open: the local server only listens on 127.0.0.1.
import crypto from 'crypto';

const COOKIE = 'ff_session';
const MAX_AGE_S = 30 * 24 * 3600;
const secret = () => process.env.DASHBOARD_PASSWORD || '';
const sign = (exp) => crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');
const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const authRequired = () => !!process.env.VERCEL || !!secret();
export const authConfigured = () => !!secret();

export function isAuthed(req) {
  if (!authRequired()) return true;
  if (!authConfigured()) return false;
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  return !!sig && Number(exp) > Date.now() && same(sig, sign(exp));
}

export const checkPassword = (pw) => authConfigured() && typeof pw === 'string' && same(pw, secret());

export function sessionCookie(req) {
  const exp = Date.now() + MAX_AGE_S * 1000;
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(exp + '.' + sign(exp))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_S}${secure}`;
}
