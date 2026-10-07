// Pulls prescriptions + stock/price data from the pharmacy MongoDB and turns
// them into the dashboard's per-month figures. The COGS maths is the pharmacy
// app's own engine (lib/cogs.js calcAll), so numbers match its Inventory report.
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { calcAll } from './lib/cogs.js';
import { getDb, closeDb } from './lib/mongo.js';
import { getState, setState } from './lib/store.js';

dotenv.config();

const lastDay = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
};

// Pure: raw collections in, { 'YYYY-MM': { rx, cogs, meta } } out.
export function computeMonths(state) {
  const dailyRxLog = state.dailyRxLog || {};
  const months = [...new Set(Object.keys(dailyRxLog).map((d) => d.slice(0, 7)))].sort();
  const out = {};

  months.forEach((m) => {
    const from = `${m}-01`;
    const to = lastDay(m);
    const full = calcAll(state, from, to);

    // Cream vs foam ingredient cost: deductions add up per Rx line, so costing
    // the cream and foam lines separately (without manual usage) splits ingCost.
    const only = (keys) => {
      const log = {};
      Object.keys(dailyRxLog).forEach((d) => {
        if (d < from || d > to) return;
        const e = dailyRxLog[d] || {};
        log[d] = Object.fromEntries(keys.map((k) => [k, e[k]]));
      });
      return calcAll({ ...state, dailyRxLog: log, manualApiUsage: [], manualPkgUsage: [], baseProductionLog: [] }, from, to).ingCost;
    };
    const creamCost = only(['rx20', 'rx50']);
    const foamCost = only(['rxfoam']);

    // Customer mix: repeat orders are re-made from scratch, so they count as new
    // (same as the pharmacy's packaging logic). The mix is applied to each kit.
    const newN = full.newCust + full.repeatCust;
    const newRatio = newN + full.oldCust > 0 ? newN / (newN + full.oldCust) : 1;
    const split = (n) => { const a = Math.round(n * newRatio); return [a, n - a]; };
    const [new_c20, refill_c20] = split(full.n20);
    const [new_c50, refill_c50] = split(full.n50);
    const [new_foam, refill_foam] = split(full.nf);

    out[m] = {
      rx: { new_c20, refill_c20, new_c50, refill_c50, new_foam, refill_foam },
      cogs: {
        cream: Math.round(creamCost),
        foam: Math.round(foamCost),
        // Packaging excluding manual waste; waste + manual ingredient usage = "manual"
        pack: Math.round(full.pkgCost - full.pkgWasteCost),
        manual: Math.round(full.manCost + full.pkgWasteCost),
      },
      meta: {
        daysLogged: Object.keys(dailyRxLog).filter((d) => d.slice(0, 7) === m).length,
        totalRx: full.tot,
        newCust: full.newCust,
        oldCust: full.oldCust,
        repeatCust: full.repeatCust,
        pharmacyGrand: Math.round(full.grand),
      },
    };
  });
  return out;
}

export async function fetchMonthlyPrescriptionsAndCOGS() {
  const db = await getDb();
  const rows = (name) => db.collection(name).find().toArray();
  const [meta, apis, creamBase, foamBase, packaging, manualApiUsage, manualPkgUsage, baseProductionLog] = await Promise.all([
    db.collection('appMeta').findOne({ _id: 'dailyRxLog' }),
    rows('apis'), rows('creamBase'), rows('foamBase'), rows('packaging'),
    rows('manualApiUsage'), rows('manualPkgUsage'), rows('baseProductionLog'),
  ]);
  if (!apis.length) throw new Error(`No ingredient prices found in database "${db.databaseName}" - check MONGODB_URI / MONGODB_DB.`);

  return computeMonths({
    dailyRxLog: meta?.value || {},
    apis, creamBase, foamBase, packaging, manualApiUsage, manualPkgUsage, baseProductionLog,
  });
}

// Merge synced figures into a dashboard state, keeping revenue, notes, manual
// COGS override and the expense ledger.
export function mergeSynced(current, synced) {
  Object.keys(synced).forEach((m) => {
    const prev = current.months[m] || {};
    current.months[m] = {
      ...prev,
      rx: synced[m].rx,
      cogs: { ...synced[m].cogs, override: prev.cogs?.override ?? '' },
    };
  });
  return current;
}

// CLI: `npm run sync` updates the stored dashboard data without starting the server.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchMonthlyPrescriptionsAndCOGS()
    .then(async (data) => {
      await setState(mergeSynced(await getState(), data));
      console.log('Synced months:', Object.keys(data).join(', '));
    })
    .catch((err) => { console.error('Sync failed:', err.message); process.exitCode = 1; })
    .finally(closeDb);
}
