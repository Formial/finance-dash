import { json, readJson } from '../lib/http.js';
import { isAuthed, refreshSession } from '../lib/auth.js';
import { getState, setState, validShape, shrinkError } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
  let body;
  try { body = await readJson(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  if (!validShape(body)) return json(res, 400, { ok: false, error: 'Expected { months: {}, ledger: [] }' });
  refreshSession(req, res);
  try {
    if (body.force !== true) {
      const problem = shrinkError(await getState(), body);
      if (problem) return json(res, 409, { ok: false, error: problem, code: 'WOULD_SHRINK' });
    }
    await setState({
      months: body.months,
      ledger: body.ledger,
      unitCosts: body.unitCosts && typeof body.unitCosts === 'object' ? body.unitCosts : undefined,
      oldUnitCosts: body.oldUnitCosts && typeof body.oldUnitCosts === 'object' ? body.oldUnitCosts : undefined,
    });
    json(res, 200, { ok: true });
  } catch (err) {
    console.error('save error:', err.message);
    json(res, 500, { ok: false, error: 'Server error' });
  }
}
