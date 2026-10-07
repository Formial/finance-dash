// Where the dashboard's own figures (revenue, notes, ledger, overrides and the
// synced numbers) live: one document in MongoDB, so the deployed site and a
// local run share the same data. data.json is only a local fallback / seed.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './mongo.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data.json');
const COLLECTION = 'financeDashboard';
export const emptyState = () => ({ months: {}, ledger: [] });

export const validShape = (d) =>
  !!d && typeof d === 'object' && !!d.months && typeof d.months === 'object' && !Array.isArray(d.months) && Array.isArray(d.ledger);

const readFile = () => {
  try { return { ...emptyState(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) { return null; }
};

export async function getState() {
  if (!process.env.MONGODB_URI) {
    if (process.env.VERCEL) throw new Error('MONGODB_URI is not set');
    return readFile() || emptyState();
  }
  const coll = (await getDb()).collection(COLLECTION);
  const doc = await coll.findOne({ _id: 'state' });
  if (doc?.value) return { ...emptyState(), ...doc.value };
  // First run: seed from a local data.json if there is one (never on Vercel).
  const seed = process.env.VERCEL ? null : readFile();
  if (seed && (Object.keys(seed.months).length || seed.ledger.length)) {
    await coll.replaceOne({ _id: 'state' }, { value: seed, updatedAt: new Date() }, { upsert: true });
    return seed;
  }
  return emptyState();
}

export async function setState(state) {
  if (!process.env.MONGODB_URI) {
    if (process.env.VERCEL) throw new Error('MONGODB_URI is not set');
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(FILE + '.tmp', FILE);
    return;
  }
  const coll = (await getDb()).collection(COLLECTION);
  await coll.replaceOne({ _id: 'state' }, { value: state, updatedAt: new Date() }, { upsert: true });
}
