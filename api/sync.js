import { json } from '../lib/http.js';
import { isAuthed } from '../lib/auth.js';
import { getState, setState } from '../lib/store.js';
import { fetchMonthlyPrescriptionsAndCOGS, mergeSynced } from '../sync.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
  try {
    const synced = await fetchMonthlyPrescriptionsAndCOGS();
    const current = mergeSynced(await getState(), synced);
    await setState(current);
    json(res, 200, { ok: true, data: current, syncedMonths: Object.keys(synced) });
  } catch (err) {
    console.error('sync error:', err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}
