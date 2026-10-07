// Pulls prescriptions + stock/price data from the pharmacy MongoDB and turns
// them into the dashboard's per-month figures. The COGS maths is the pharmacy
// app's own engine (lib/cogs.js calcAll), so numbers match its Inventory report.
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calcAll } from './lib/cogs.js';

dotenv.config();

try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same rule as the pharmacy app: MONGODB_DB if set, else the database named in
// the connection string, else formial-pharmacy.
function dbNameFor(uri) {
  if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : 'formial-pharmacy';
}

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
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in .env');

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const db = client.db(dbNameFor(uri));
    const rows = (name) => db.collection(name).find().toArray();
    const [meta, apis, creamBase, foamBase, packaging, manualApiUsage, manualPkgUsage, baseProductionLog] = await Promise.all([
      db.collection('appMeta').findOne({ _id: 'dailyRxLog' }),
      rows('apis'), rows('creamBase'), rows('foamBase'), rows('packaging'),
      rows('manualApiUsage'), rows('manualPkgUsage'), rows('baseProductionLog'),
    ]);
    if (!apis.length) throw new Error(`No ingredient prices found in database "${db.databaseName}" — check MONGODB_URI / MONGODB_DB.`);

    return computeMonths({
      dailyRxLog: meta?.value || {},
      apis, creamBase, foamBase, packaging, manualApiUsage, manualPkgUsage, baseProductionLog,
    });
  } finally {
    await client.close();
  }
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

// CLI: `npm run sync` updates data.json without starting the server.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(__dirname, 'data.json');
  fetchMonthlyPrescriptionsAndCOGS()
    .then((data) => {
      let current = { months: {}, ledger: [] };
      try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
      fs.writeFileSync(file, JSON.stringify(mergeSynced(current, data), null, 2), 'utf8');
      console.log('Synced months:', Object.keys(data).join(', '));
    })
    .catch((err) => { console.error('Sync failed:', err.message); process.exit(1); });
}
