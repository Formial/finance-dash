// Where the dashboard's own figures (revenue, notes, ledger, overrides and the
// synced numbers) live: one document in MongoDB, so the deployed site and a
// local run share the same data. data.json is only a local fallback / seed.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './mongo.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data.json');
const COLLECTION = 'financeDashboard';
const BACKUPS = 'financeDashboardBackups';
const KEEP_BACKUPS = 120;
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

// Refuses a save that would silently destroy data: a month that exists on the
// server may not disappear, and the ledger may not lose more than 3 entries at once.
// Returns an error message, or null when the save is fine.
export function shrinkError(prev, next) {
  const gone = Object.keys(prev?.months || {}).filter((m) => !(m in (next?.months || {})));
  if (gone.length) return `This save would delete month(s) ${gone.join(', ')} that exist on the server.`;
  if ((next?.ledger?.length || 0) < (prev?.ledger?.length || 0) - 3) return 'This save would delete several ledger entries at once.';
  return null;
}

// One snapshot per day (the state as it was before that day's first save), newest 120 kept.
async function backupBeforeSave(db, prevDoc) {
  if (!prevDoc?.value) return;
  const day = new Date().toISOString().slice(0, 10);
  const coll = db.collection(BACKUPS);
  const r = await coll.updateOne({ _id: day }, { $setOnInsert: { value: prevDoc.value, savedAt: new Date() } }, { upsert: true });
  if (r.upsertedCount) {
    const old = await coll.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).skip(KEEP_BACKUPS).toArray();
    if (old.length) await coll.deleteMany({ _id: { $in: old.map((d) => d._id) } });
  }
}

export async function listBackups() {
  if (!process.env.MONGODB_URI) return [];
  return (await getDb()).collection(BACKUPS).find({}, { projection: { _id: 1, savedAt: 1, 'value.ledger': 1 } }).sort({ _id: -1 }).toArray();
}

export async function getBackup(day) {
  const doc = await (await getDb()).collection(BACKUPS).findOne({ _id: day });
  return doc?.value || null;
}

export async function setState(state) {
  if (!process.env.MONGODB_URI) {
    if (process.env.VERCEL) throw new Error('MONGODB_URI is not set');
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(FILE + '.tmp', FILE);
    return;
  }
  const db = await getDb();
  const coll = db.collection(COLLECTION);
  try { await backupBeforeSave(db, await coll.findOne({ _id: 'state' })); } catch (e) { console.error('backup failed:', e.message); }
  await coll.replaceOne({ _id: 'state' }, { value: state, updatedAt: new Date() }, { upsert: true });
}
