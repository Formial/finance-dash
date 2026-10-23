// Lists or restores the daily backups of the finance figures.
//   npm run backups                 list available backups
//   npm run backups -- 2026-10-09   restore that day's backup (the current state is backed up first)
import dotenv from 'dotenv';
import { closeDb } from './lib/mongo.js';
import { getState, setState, listBackups, getBackup } from './lib/store.js';

dotenv.config();
const day = process.argv[2];

try {
  if (!day) {
    const list = await listBackups();
    if (!list.length) console.log('No backups yet.');
    list.forEach((b) => console.log(b._id, `· ${Object.keys(b.value?.months || {}).length} months`, `· ${(b.value?.ledger || []).length} ledger entries`));
  } else {
    const snap = await getBackup(day);
    if (!snap) throw new Error(`No backup for ${day}`);
    await setState(await getState()); // makes sure today's pre-restore snapshot exists
    await setState(snap);
    console.log(`Restored ${day}: ${Object.keys(snap.months || {}).join(', ')}`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
