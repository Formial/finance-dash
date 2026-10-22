// Failed-login throttle: 5 wrong passwords from one address locks that address
// out for 15 minutes. Counts live in MongoDB when it is configured (so they
// survive serverless cold starts and are shared by every instance), else in memory.
import { getDb } from './mongo.js';

const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const COLLECTION = 'financeLoginAttempts';
const mem = new Map();

export function clientIp(req) {
  const h = req.headers;
  const ip = h['x-vercel-forwarded-for'] || h['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  return String(ip).split(',')[0].trim();
}

async function load(ip) {
  if (process.env.MONGODB_URI) {
    try { return await (await getDb()).collection(COLLECTION).findOne({ _id: ip }); } catch (e) { /* fall through */ }
  }
  return mem.get(ip) || null;
}

async function store(ip, doc) {
  mem.set(ip, doc);
  if (process.env.MONGODB_URI) {
    try { await (await getDb()).collection(COLLECTION).replaceOne({ _id: ip }, { ...doc, _id: ip, at: new Date() }, { upsert: true }); } catch (e) { /* memory copy still applies */ }
  }
}

// Returns seconds to wait if this address is locked out, else 0.
export async function lockedFor(ip) {
  const d = await load(ip);
  return d && d.until > Date.now() ? Math.ceil((d.until - Date.now()) / 1000) : 0;
}

export async function recordFail(ip) {
  const now = Date.now();
  const d = await load(ip);
  const fresh = !d || now - d.first > WINDOW_MS;
  const n = fresh ? 1 : d.n + 1;
  await store(ip, { n, first: fresh ? now : d.first, until: n >= MAX_FAILS ? now + WINDOW_MS : 0 });
}

export async function clearFails(ip) {
  mem.delete(ip);
  if (process.env.MONGODB_URI) {
    try { await (await getDb()).collection(COLLECTION).deleteOne({ _id: ip }); } catch (e) { /* ignore */ }
  }
}
