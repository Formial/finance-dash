import { json, readJson } from '../lib/http.js';
import { isAuthed } from '../lib/auth.js';
import { setState, validShape } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
  let body;
  try { body = await readJson(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  if (!validShape(body)) return json(res, 400, { ok: false, error: 'Expected { months: {}, ledger: [] }' });
  try {
    await setState({ months: body.months, ledger: body.ledger });
    json(res, 200, { ok: true });
  } catch (err) {
    console.error('save error:', err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}
