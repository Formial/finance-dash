// Pulls the daily prescription log from the pharmacy MongoDB and turns it into
// per-month pump counts. Costs are NOT taken from the pharmacy: the dashboard
// multiplies these counts by its own saved cost per pump.
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { getDb, closeDb } from './lib/mongo.js';
import { getState, setState } from './lib/store.js';

dotenv.config();

// One non-empty line in the log = one prescription (same rule as the pharmacy app).
const countLines = (txt) => (typeof txt === 'string' ? txt.split('\n').filter((l) => l.trim()).length : 0);

// Pure: dailyRxLog in, { 'YYYY-MM': { pumps: { new, refill, foam }, meta } } out.
//  - cream (20g + 50g) lines are split into new / refill using the customer
//    counts logged each day; repeat orders are re-made from scratch, so they
//    count as new (same as the pharmacy's packaging logic)
//  - foam lines are counted as foam
export function computeMonths(dailyRxLog = {}) {
  const months = {};
  Object.keys(dailyRxLog).sort().forEach((d) => {
    const e = dailyRxLog[d];
    if (!e || typeof e !== 'object') return;
    const m = (months[d.slice(0, 7)] = months[d.slice(0, 7)] || { cream: 0, foam: 0, newCust: 0, oldCust: 0, repeatCust: 0, days: 0 });
    m.cream += countLines(e.rx20) + countLines(e.rx50);
    m.foam += countLines(e.rxfoam);
    m.newCust += +e.newCust || 0;
    m.oldCust += +e.oldCust || 0;
    m.repeatCust += +e.repeatCust || 0;
    m.days += 1;
  });

  const out = {};
  Object.keys(months).forEach((k) => {
    const m = months[k];
    const newN = m.newCust + m.repeatCust;
    const ratio = newN + m.oldCust > 0 ? newN / (newN + m.oldCust) : 1;
    const newPumps = Math.round(m.cream * ratio);
    out[k] = {
      pumps: { new: newPumps, refill: m.cream - newPumps, foam: m.foam },
      meta: { daysLogged: m.days, newCust: m.newCust, oldCust: m.oldCust, repeatCust: m.repeatCust },
    };
  });
  return out;
}

export async function fetchMonthlyPumps() {
  const db = await getDb();
  const doc = await db.collection('appMeta').findOne({ _id: 'dailyRxLog' });
  return computeMonths(doc?.value || {});
}

// Merge synced counts into the dashboard state. Lotion counts, notes, any manual
// Rx-cost override and the expense ledger are kept; old rx/cogs fields are dropped.
export function mergeSynced(current, synced) {
  Object.keys(synced).forEach((m) => {
    const prev = current.months[m] || {};
    const { rx, cogs, ...rest } = prev;
    const override = rest.override !== undefined ? rest.override : cogs?.override ?? '';
    current.months[m] = { ...rest, override, pumps: { ...(rest.pumps || {}), ...synced[m].pumps } };
  });
  return current;
}

// CLI: `npm run sync` updates the stored dashboard data without starting the server.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchMonthlyPumps()
    .then(async (data) => {
      await setState(mergeSynced(await getState(), data));
      console.log('Synced months:', Object.keys(data).join(', '));
    })
    .catch((err) => { console.error('Sync failed:', err.message); process.exitCode = 1; })
    .finally(closeDb);
}
