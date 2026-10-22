// Google sign-in gate. Only the emails listed in ALLOWED_EMAILS can get in.
// /api/login verifies a Google ID token and, if the email is on the list,
// issues a signed, HttpOnly session cookie. Every data call re-checks that cookie
// AND that the email is still on the list, so removing an email cuts that person
// off straight away. On Vercel with nothing configured, everything stays locked
// (fail closed). A local run with no ALLOWED_EMAILS is open: the local server only
// listens on 127.0.0.1.
import crypto from 'crypto';

const COOKIE = 'ff_session';
const MAX_AGE_S = 12 * 3600; // short-lived session: sign in again each day

export const allowedEmails = () =>
  (process.env.ALLOWED_EMAILS || '').split(/[,\s;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
export const isAllowed = (email) => !!email && allowedEmails().includes(String(email).toLowerCase());

export const googleClientId = () => process.env.GOOGLE_CLIENT_ID || '';
export const authRequired = () => !!process.env.VERCEL || allowedEmails().length > 0;
export const authConfigured = () => !!googleClientId() && allowedEmails().length > 0;

// Cookies are signed with SESSION_SECRET, or (if unset) a hash of other server-only secrets.
const key = () =>
  crypto.createHash('sha256')
    .update(process.env.SESSION_SECRET || `${process.env.MONGODB_URI || ''}|${process.env.GOOGLE_CLIENT_ID || ''}|${process.env.ALLOWED_EMAILS || ''}`)
    .digest();
const sign = (data) => crypto.createHmac('sha256', key()).update(data).digest('hex');
const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function readSession(req) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const [data, sig] = decodeURIComponent(m[1]).split('.');
  if (!data || !sig || !same(sig, sign(data))) return null;
  try {
    const s = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return Number(s.exp) > Date.now() && isAllowed(s.email) ? s : null;
  } catch (e) { return null; }
}

export function isAuthed(req) {
  if (!authRequired()) return true;
  if (!authConfigured()) return false;
  return !!readSession(req);
}

export const sessionUser = (req) => (authRequired() ? readSession(req) : { email: 'local', name: 'Local' });

export function sessionCookie(req, user) {
  const data = Buffer.from(JSON.stringify({ email: user.email, name: user.name || '', exp: Date.now() + MAX_AGE_S * 1000 })).toString('base64url');
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(data + '.' + sign(data))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_S}${secure}`;
}

export const clearCookie = (req) =>
  `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;
