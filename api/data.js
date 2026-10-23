import { json } from '../lib/http.js';
import { isAuthed, refreshSession } from '../lib/auth.js';
import { getState } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
  refreshSession(req, res);
  try {
    json(res, 200, await getState());
  } catch (err) {
    console.error('data error:', err.message);
    json(res, 500, { error: 'Server error' });
  }
}
