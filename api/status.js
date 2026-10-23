import { json } from '../lib/http.js';
import { authRequired, isAuthed, googleClientId, sessionUser, refreshSession } from '../lib/auth.js';

export default function handler(req, res) {
  const authed = isAuthed(req);
  if (authed) refreshSession(req, res);
  json(res, 200, {
    ok: true,
    authRequired: authRequired(),
    authed,
    googleClientId: authRequired() ? googleClientId() : '', // public identifier, needed by the sign-in button
    email: authed ? sessionUser(req)?.email || '' : '',
  });
}
