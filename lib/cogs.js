// Copied from formial_pharmacy_dashboard/src/components/inventory/cogs.js (import path adjusted) — re-copy if the pharmacy COGS logic changes.
// COGS orchestration for the Inventory page.
// This is the React port of Inventory/index.html's calcAll()/closeMonth() logic
// (lines ~442-519 and ~676-738 of the original). It calls into the shared,
// already-verified formula engine (src/lib/formulas.js) for the actual
// per-Rx deduction math (creamDeduction/foamDeduction) and only handles the
// orchestration: aggregating the daily log, resolving deduction keys to live
// stock rows, and rolling everything up into costs.

import { parseRxBlock, creamDeduction, foamDeduction, mergeDeductions } from './formulas.js';

// Strips everything but lowercase alphanumerics — used only for fuzzy-matching
// a deduction key (e.g. "sodium metabisulphite") against a stock row's name.
// This mirrors the original's inline `norm()` used by resD(), which is a
// different (stricter) function from formulas.js's own `norm()`.
export function stripNorm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function cpg(ing) {
  if (!ing) return 0;
  const bought = +ing.bought || 0;
  const price = +ing.price || 0;
  return bought > 0 ? price / bought : 0;
}

export function formatINR(n) {
  return '₹' + Math.round(n || 0).toLocaleString('en-IN');
}

export function pctOf(v, t) {
  return t > 0 ? ((v / t) * 100).toFixed(1) : '0.0';
}

export function countLines(txt) {
  return (txt || '').split('\n').filter((l) => l.trim()).length;
}

export function genCode(name, existingCodes) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  let c = words.length <= 1 ? (name || '').substring(0, 4).toUpperCase() : words.map((w) => w[0]).join('').toUpperCase().substring(0, 5);
  if (!c) c = 'NEW';
  let f = c;
  let n = 2;
  while (existingCodes.includes(f)) f = c + n++;
  return f;
}

// Special-cased resolvers for deduction keys that don't map 1:1 onto an
// ingredient's own name (tretinoin's solvent, the fixed excipients, the
// bulk base rows). Anything else falls through to fuzzy substring matching.
const SPECIAL_RESOLVERS = {
  tretinoin: (apis) => (apis || []).find((a) => stripNorm(a?.name).includes('tretinoin') && a?.type === 'API'),
  'transcutol-p': (apis) => (apis || []).find((a) => stripNorm(a?.name).includes('transcutol')),
  bht: (apis) => (apis || []).find((a) => stripNorm(a?.code) === 'bht' || stripNorm(a?.name) === 'bht'),
  'sodium metabisulphite': (apis) =>
    (apis || []).find((a) => stripNorm(a?.name).includes('metabisulph') || stripNorm(a?.name).includes('metabisulf')),
  edta: (apis) => (apis || []).find((a) => stripNorm(a?.name).includes('edta')),
  'propylene glycol': (apis) => (apis || []).find((a) => stripNorm(a?.name).includes('propylene')),
  'cream base': (apis) => (apis || []).find((a) => a?.code === 'CB'),
  'foam base': (apis) => (apis || []).find((a) => a?.code === 'FB'),
  polysorbate: (apis) => (apis || []).find((a) => stripNorm(a?.name).includes('polysorbate')),
};

export function resolveDeductions(dedMap = {}, apisList = []) {
  const list = Array.isArray(apisList) ? apisList : [];
  return Object.keys(dedMap || {}).map((key) => {
    const grams = dedMap[key] || 0;
    let ing = null;
    const special = SPECIAL_RESOLVERS[key];
    if (special) ing = special(list);
    if (!ing) {
      const nk = stripNorm(key);
      ing = list.find((a) => {
        const na = stripNorm(a?.name);
        return na === nk || (nk && na.includes(nk)) || (na && nk.includes(na));
      });
    }
    return { key, grams, ing };
  });
}

// Aggregates every daily-log Rx line within [from,to] (inclusive, string
// comparison on YYYY-MM-DD keys — from/to may be falsy to mean unbounded).
export function aggRx(dailyRxLog = {}, from, to) {
  const a20 = [];
  const a50 = [];
  const af = [];
  Object.keys(dailyRxLog || {}).forEach((d) => {
    if (from && d < from) return;
    if (to && d > to) return;
    const e = dailyRxLog[d];
    if (!e || typeof e !== 'object') return;
    if (e.rx20 && typeof e.rx20 === 'string') e.rx20.split('\n').filter(Boolean).forEach((l) => a20.push(l));
    if (e.rx50 && typeof e.rx50 === 'string') e.rx50.split('\n').filter(Boolean).forEach((l) => a50.push(l));
    if (e.rxfoam && typeof e.rxfoam === 'string') e.rxfoam.split('\n').filter(Boolean).forEach((l) => af.push(l));
  });
  return { rx20: a20.join('\n'), rx50: a50.join('\n'), rxfoam: af.join('\n') };
}

// Sums the New/Old/Repeat split within [from,to], the same window aggRx()
// uses. Each day's counts are saved alongside that day's prescriptions
// (DailyUploadTab), not as one running total, so a report scoped to a date
// range only reflects the days actually inside it.
export function aggCustomerCounts(dailyRxLog = {}, from, to) {
  let newCust = 0;
  let oldCust = 0;
  let repeatCust = 0;
  Object.keys(dailyRxLog || {}).forEach((d) => {
    if (from && d < from) return;
    if (to && d > to) return;
    const e = dailyRxLog[d];
    if (!e || typeof e !== 'object') return;
    newCust += +e.newCust || 0;
    oldCust += +e.oldCust || 0;
    repeatCust += +e.repeatCust || 0;
  });
  return { newCust, oldCust, repeatCust };
}

function inRange(date, from, to) {
  return (!from || !date || date >= from) && (!to || !date || date <= to);
}

/**
 * Calculates auto-used count for a packaging item based on multi-selected kits and customer types.
 */
export function calcPkgAutoUsed(p, { n20 = 0, n50 = 0, nf = 0, newCust = 0, oldCust = 0, repeatCust = 0 }) {
  if (!p) return 0;

  // Resolve active customer types. 'repeat' is no longer offered as a tag,
  // because a redo consumes the same kit as a new order, but stored items may
  // still carry it — those map onto 'new'.
  const rawTypes = Array.isArray(p.custTypes) && p.custTypes.length > 0
    ? p.custTypes
    : p.custType === 'none'
      ? ['none']
      : p.custType === 'new'
        ? ['new']
        : p.custType === 'old'
          ? ['old']
          : p.custType === 'repeat'
            ? ['new']
            : ['all'];
  const custTypes = [...new Set(rawTypes.map((t) => (t === 'repeat' ? 'new' : t)))];

  if (custTypes.includes('none') || p.custType === 'none') {
    return 0; // Manual only
  }

  // Resolve active kits
  let kits = [];
  if (Array.isArray(p.kits) && p.kits.length > 0) {
    kits = p.kits;
  } else {
    const k = p.kit || '20g';
    if (k === '50g') kits = ['50g'];
    else if (k === 'foam') kits = ['foam'];
    else if (k === '20g+50g' || k === '20g + 50g' || k === 'cream') kits = ['20g', '50g'];
    else if (k === '50g+foam' || k === 'foam+50g') kits = ['50g', 'foam'];
    else if (k === '20g+foam' || k === 'foam+20g') kits = ['20g', 'foam'];
    else if (k === 'general' || k === 'all') kits = ['20g', '50g', 'foam'];
    else kits = ['20g'];
  }

  let total = 0;

  // 1. Foam usage
  if (kits.includes('foam')) {
    total += nf;
  }

  // 2. 50g usage
  if (kits.includes('50g')) {
    total += n50;
  }

  // 3. 20g usage (respects customer segments if specified)
  if (kits.includes('20g')) {
    if (custTypes.includes('all')) {
      total += n20;
    } else {
      let custSum = 0;
      // A repeat is a package that went out and never arrived, so the whole
      // order is made again from scratch — for stock purposes it costs exactly
      // what a new one does, and counts alongside the new customers.
      if (custTypes.includes('new')) custSum += newCust + repeatCust;
      if (custTypes.includes('old')) custSum += oldCust;
      total += (custSum > 0 || custTypes.length > 0) ? custSum : n20;
    }
  }

  return total;
}

// Human label for what a packaging item auto-deducts against — the report's
// packaging table shows this next to the count calcPkgAutoUsed() produces,
// so it resolves kits/custTypes the same way rather than a second copy that
// can (and did) drift out of sync with it.
export function describePkgTarget(p) {
  if (!p) return 'All';
  const rawTypes = Array.isArray(p.custTypes) && p.custTypes.length > 0
    ? p.custTypes
    : p.custType === 'none'
      ? ['none']
      : p.custType === 'new'
        ? ['new']
        : p.custType === 'old'
          ? ['old']
          : p.custType === 'repeat'
            ? ['new']
            : ['all'];
  const custTypes = [...new Set(rawTypes.map((t) => (t === 'repeat' ? 'new' : t)))];

  if (custTypes.includes('none')) return 'None (Manual)';

  let kits = [];
  if (Array.isArray(p.kits) && p.kits.length > 0) {
    kits = p.kits;
  } else {
    const k = p.kit || '20g';
    if (k === '50g') kits = ['50g'];
    else if (k === 'foam') kits = ['foam'];
    else if (k === '20g+50g' || k === '20g + 50g' || k === 'cream') kits = ['20g', '50g'];
    else if (k === '50g+foam' || k === 'foam+50g') kits = ['50g', 'foam'];
    else if (k === '20g+foam' || k === 'foam+20g') kits = ['20g', 'foam'];
    else if (k === 'general' || k === 'all') kits = ['20g', '50g', 'foam'];
    else kits = ['20g'];
  }

  if (kits.length > 1 || custTypes.includes('all')) {
    if (kits.includes('20g') && kits.includes('50g') && kits.includes('foam')) return 'All Orders';
    if (kits.includes('20g') && kits.includes('50g')) return 'All 20g+50g';
    if (kits.includes('50g') && kits.includes('foam')) return 'All 50g+Foam';
    if (kits.includes('20g') && kits.includes('foam')) return 'All 20g+Foam';
  }
  if (kits.includes('foam') && !kits.includes('20g') && !kits.includes('50g')) return 'All Foam';
  if (kits.includes('50g') && !kits.includes('20g') && !kits.includes('foam')) return 'All 50g';

  if (kits.includes('20g')) {
    if (custTypes.includes('all')) return 'All 20g';
    const parts = [];
    if (custTypes.includes('new')) parts.push('New');
    if (custTypes.includes('old')) parts.push('Old');
    return parts.length ? `${parts.join(' + ')} (20g)` : 'All 20g';
  }
  return 'All';
}

// The full monthly COGS calculation. Mirrors calcAll() in the original app.
export function calcAll(state = {}, from, to) {
  const {
    apis = [],
    creamBase = [],
    foamBase = [],
    packaging = [],
    dailyRxLog = {},
    manualApiUsage = [],
    manualPkgUsage = [],
    baseProductionLog = [],
  } = state || {};

  const safeApis = Array.isArray(apis) ? apis : [];
  const safeCreamBase = Array.isArray(creamBase) ? creamBase : [];
  const safeFoamBase = Array.isArray(foamBase) ? foamBase : [];
  const safePackaging = Array.isArray(packaging) ? packaging : [];
  const safeDailyRxLog = dailyRxLog && typeof dailyRxLog === 'object' ? dailyRxLog : {};
  const safeManualApiUsage = Array.isArray(manualApiUsage) ? manualApiUsage : [];
  const safeManualPkgUsage = Array.isArray(manualPkgUsage) ? manualPkgUsage : [];
  const safeBaseProductionLog = Array.isArray(baseProductionLog) ? baseProductionLog : [];

  const agg = aggRx(safeDailyRxLog, from, to);
  const r20 = parseRxBlock(agg.rx20, 20);
  const r50 = parseRxBlock(agg.rx50, 50);
  const rf = parseRxBlock(agg.rxfoam, 50);
  const n20 = r20.length;
  const n50 = r50.length;
  const nf = rf.length;
  const tot = n20 + n50 + nf;

  const allDed = mergeDeductions([
    ...r20.map((rx) => creamDeduction(rx.apiList, rx.size)),
    ...r50.map((rx) => creamDeduction(rx.apiList, rx.size)),
    ...rf.map((rx) => foamDeduction(rx.apiList)),
  ]);

  const resolved = resolveDeductions(allDed, safeApis);
  let ingCost = 0;
  const usageMap = {};
  resolved.forEach((r) => {
    const c = r.ing ? cpg(r.ing) * r.grams : 0;
    ingCost += c;
    const code = r.ing ? r.ing.code : r.key;
    if (!usageMap[code]) usageMap[code] = { grams: 0, cost: 0, ing: r.ing };
    usageMap[code].grams += r.grams;
    usageMap[code].cost += c;
  });

  const fManApi = safeManualApiUsage.filter((e) => inRange(e.date, from, to));
  const fManPkg = safeManualPkgUsage.filter((e) => inRange(e.date, from, to));

  let manApiCost = 0;
  const manApiByCode = {};
  fManApi.forEach((e) => {
    const ing = safeApis.find((a) => a.code === e.ingCode);
    const c = cpg(ing) * (e.grams || 0);
    manApiCost += c;
    if (!manApiByCode[e.ingCode]) manApiByCode[e.ingCode] = { grams: 0, cost: 0, name: e.ingName };
    manApiByCode[e.ingCode].grams += e.grams || 0;
    manApiByCode[e.ingCode].cost += c;
  });

  const manCost = manApiCost;
  ingCost += manCost;

  const fProdLog = safeBaseProductionLog.filter((e) => inRange(e.date, from, to));
  const cProd = fProdLog.filter((e) => e.type === 'cream').reduce((s, e) => s + (e.qty || 0), 0);
  const fProd = fProdLog.filter((e) => e.type === 'foam').reduce((s, e) => s + (e.qty || 0), 0);

  const cIngU = {};
  safeCreamBase.forEach((a) => {
    const u = ((+a.pct || 0) / 100) * cProd;
    cIngU[a.code] = { grams: u, cost: cpg(a) * u };
  });
  const fIngU = {};
  safeFoamBase.forEach((a) => {
    const u = ((+a.pct || 0) / 100) * fProd;
    fIngU[a.code] = { grams: u, cost: cpg(a) * u };
  });

  const pkgWasteMap = {};
  fManPkg.forEach((e) => {
    pkgWasteMap[e.pkgName] = (pkgWasteMap[e.pkgName] || 0) + (+e.qty || 0);
  });

  // Each day's own New/Old/Repeat split, saved alongside its prescriptions —
  // summed over the same [from,to] window as the Rx lines above, so this
  // scopes correctly to whatever date range is being reported on.
  const { newCust, oldCust, repeatCust } = aggCustomerCounts(safeDailyRxLog, from, to);
  const totRx = n20 + n50 + nf;

  let pkgCost = 0;
  let pkgWasteCost = 0;
  safePackaging.forEach((p) => {
    const au = calcPkgAutoUsed(p, { n20, n50, nf, newCust, oldCust, repeatCust });
    const waste = pkgWasteMap[p.name] || 0;
    const price = +p.price || 0;
    pkgCost += (au + waste) * price;
    pkgWasteCost += waste * price;
  });

  const grand = ingCost + pkgCost;

  return {
    n20,
    n50,
    nf,
    tot,
    newCust,
    oldCust,
    repeatCust,
    usageMap,
    ingCost,
    cProd,
    fProd,
    cIngU,
    fIngU,
    pkgCost,
    pkgWasteCost,
    pkgWasteMap,
    manCost,
    manApiCost,
    manApiByCode,
    fManApi,
    fManPkg,
    grand,
  };
}

export function packagingReport(packaging, calcResult) {
  const { n20, n50, nf, newCust, oldCust, repeatCust, pkgWasteMap } = calcResult;
  return packaging.map((p) => {
    const au = calcPkgAutoUsed(p, { n20, n50, nf, newCust, oldCust, repeatCust });
    const waste = (pkgWasteMap && pkgWasteMap[p.name]) || 0;
    const totalUsed = au + waste;
    const stock = +p.stock || 0;
    const remaining = stock - totalUsed;
    const price = +p.price || 0;
    const cost = totalUsed * price;
    return {
      id: p.id,
      name: p.name,
      kit: p.kit,
      kits: p.kits,
      custType: p.custType,
      custTypes: p.custTypes,
      stock,
      price,
      autoUsed: au,
      waste,
      totalUsed,
      remaining,
      cost,
    };
  });
}
