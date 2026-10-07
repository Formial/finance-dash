import { json } from '../lib/http.js';
import { authRequired, authConfigured, isAuthed } from '../lib/auth.js';

export default function handler(req, res) {
  json(res, 200, {
    ok: true,
    mongoConfigured: !!process.env.MONGODB_URI,
    authRequired: authRequired(),
    authConfigured: !authRequired() || authConfigured(),
    authed: isAuthed(req),
  });
}
