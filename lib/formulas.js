// Copied verbatim from formial_pharmacy_dashboard/src/lib/formulas.js — re-copy if the pharmacy formulas change.
// Shared compounding math for Inventory + Batches.
// Ported 1:1 from the original Formial Labs `Inventory` and `batches` apps,
// which had independently duplicated this logic — this is now the single
// source of truth for both.

// Tretinoin is dispensed as a 0.1g/10ml (0.01 g/ml) solution in Transcutol-P,
// so its API weight must be converted to a solvent volume rather than dosed neat.
export const TRET_CONC_G_PER_ML = 0.01;
// BHT and Sodium Metabisulphite (antioxidant/preservative pair) are dosed at a
// flat 0.1% of batch weight in every cream batch; EDTA joins them only when
// Azelaic Acid is in the formula (chelator needed for its stability).
export const EXC_PCT = 0.1;
// Foam batches always carry Polysorbate at 4% as the surfactant/solubilizer.
export const FOAM_POLYSORBATE_PCT = 4;

export const EXCIPIENTS = ['EDTA', 'BHT', 'Sodium Metabisulphite'];

// 15ml pump sizing:
// - 8 pumps or fewer: 1=20g, 2=40g, 3+=40+(n-2)*15g (e.g. 8 pumps = 130g).
// - More than 8 pumps: an extra 20g tier before the +15g steps resume —
//   1=20g, 2=40g, 3=60g, 4+=60+(n-3)*15g (e.g. 9 pumps = 150g, not 145g).
// A 50ml "body pump" is always 55g/unit either way.
export function batchGrams(count, batchType) {
  if (batchType === 'body50') return count * 55;
  if (count <= 0) return 0;
  if (count > 8) return 60 + (count - 3) * 15;
  if (count === 1) return 20;
  if (count === 2) return 40;
  return 40 + (count - 2) * 15;
}

export function norm(name) {
  return (name || '').toLowerCase();
}

export function isTCS(apiList) {
  const n = apiList.map((i) => norm(i.name));
  return (
    n.some((x) => x.includes('tretinoin')) &&
    n.some((x) => x.includes('clindamycin')) &&
    n.some((x) => x.includes('spironolactone'))
  );
}

export function hasAzelaicAcid(apiList) {
  return apiList.some((i) => norm(i.name).includes('azelaic'));
}

// TCS's solvent (Propylene Glycol) is dosed at a flat 3.5% of batch weight.
// Every other formula's solvent (Transcutol-P) stays scaled at 50% of the
// combined non-tretinoin API weight, same as always.
export const TCS_SOLVENT_PCT = 3.5;

// Expands a raw API/actives list (name + %) into the full cream formula:
// actives + fixed excipients (BHT, Na-metabisulphite, conditional EDTA) +
// a solvent line (Propylene Glycol for TCS at a flat 3.5%, Transcutol-P
// otherwise at 50% of the combined non-tretinoin API weight).
export function expandCreamFormula(apiList) {
  const hasAz = hasAzelaicAcid(apiList);
  const tcs = isTCS(apiList);
  const exc = EXCIPIENTS.filter((e) => !(e === 'EDTA' && !hasAz)).map((name) => ({
    name,
    percent: EXC_PCT,
  }));
  const nonTretPct = apiList
    .filter((i) => !norm(i.name).includes('tretinoin'))
    .reduce((s, i) => s + i.percent, 0);
  const solventPct = tcs ? TCS_SOLVENT_PCT : nonTretPct * 0.5;
  const solvent =
    solventPct > 0
      ? { name: tcs ? 'Propylene Glycol' : 'Transcutol-P', percent: solventPct }
      : null;
  return [...apiList, ...exc, ...(solvent ? [solvent] : [])];
}

// Turns an expanded formula + pump count into printable batch-card rows
// (gram/ml quantities per ingredient, q.s.'d to 100% with Cream Base).
export function computeBatchRows(apiList, count, batchType) {
  const full = expandCreamFormula(apiList);
  const totalGrams = batchGrams(count, batchType);
  const specifiedPct = full.reduce((s, i) => s + i.percent, 0);
  const basePct = 100 - specifiedPct;
  let tretVolumeExcess = 0;
  const rows = [];
  for (const ing of full) {
    const g = (ing.percent / 100) * totalGrams;
    const n = norm(ing.name);
    const isTret = n.includes('tretinoin');
    const isSolvent = n.includes('transcutol') || n.includes('propylene glycol');
    const isExc = EXCIPIENTS.includes(ing.name);
    if (isTret) {
      const ml = g / TRET_CONC_G_PER_ML;
      tretVolumeExcess += ml - g;
      rows.push({ name: `${ing.name} *`, pct: ing.percent, qty: ml, type: 'tret' });
    } else if (isSolvent) {
      rows.push({ name: `${ing.name} **`, pct: ing.percent, qty: g, type: 'solv' });
    } else if (isExc) {
      rows.push({ name: ing.name, pct: ing.percent, qty: g, type: 'exc' });
    } else {
      rows.push({ name: ing.name, pct: ing.percent, qty: g, type: 'api' });
    }
  }
  rows.push({ name: 'Base (q.s.)', pct: basePct, qty: (basePct / 100) * totalGrams - tretVolumeExcess, type: 'base' });
  rows.push({ name: 'TOTAL', pct: 100, qty: totalGrams, type: 'total' });
  return rows;
}

export function foamRows(apiList, totalGrams) {
  let used = 0;
  const rows = apiList.map((ing) => {
    used += ing.percent;
    return { name: ing.name, pct: ing.percent, qty: (ing.percent / 100) * totalGrams, type: 'api' };
  });
  used += FOAM_POLYSORBATE_PCT;
  rows.push({
    name: 'Polysorbate 20',
    pct: FOAM_POLYSORBATE_PCT,
    qty: (FOAM_POLYSORBATE_PCT / 100) * totalGrams,
    type: 'exc',
  });
  const basePct = Math.max(0, 100 - used);
  rows.push({ name: 'Foam Base (q.s.)', pct: basePct, qty: (basePct / 100) * totalGrams, type: 'base' });
  rows.push({ name: 'TOTAL', pct: 100, qty: totalGrams, type: 'total' });
  return rows;
}

// Parses "Ingredient %  + Ingredient %" lines into {raw, apiList, size}.
// A trailing "50ml" / "body pump" marker switches the line to the 55g body-pump size.
export function parseRxLine(line, defaultSize) {
  let batchType = 'standard';
  let clean = line.trim();
  if (/\b50\s*ml\b/i.test(clean) || /\bbody\s*pump\b/i.test(clean)) {
    batchType = 'body50';
    clean = clean.replace(/\s*\b50\s*ml\b/gi, '').replace(/\s*\bbody\s*pump\b/gi, '').trim();
  }
  const apiList = clean
    .split('+')
    .map((s) => {
      const m = s.trim().match(/^(.+?)\s+([\d.]+)%/);
      return m ? { name: m[1].trim(), percent: parseFloat(m[2]) } : null;
    })
    .filter(Boolean);
  return { raw: line.trim(), apiList, size: defaultSize, batchType };
}

export function parseRxBlock(text, defaultSize) {
  if (!text || !text.trim()) return [];
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => parseRxLine(line, defaultSize));
}

// ── Ingredient-level stock deduction engine (for Inventory COGS) ──
// Converts a parsed cream Rx into {normalizedIngredientKey: grams} deductions.
export function creamDeduction(apiList, batchSizeGrams) {
  const d = {};
  const add = (k, g) => {
    d[k] = (d[k] || 0) + g;
  };
  const tcs = isTCS(apiList);
  const az = hasAzelaicAcid(apiList);
  let nonTretGrams = 0;
  apiList.forEach((api) => {
    const g = (api.percent / 100) * batchSizeGrams;
    if (norm(api.name).includes('tretinoin')) {
      const ml = g / TRET_CONC_G_PER_ML;
      add('tretinoin', g);
      add('transcutol-p', ml);
    } else {
      add(norm(api.name), g);
      nonTretGrams += g;
    }
  });
  add('bht', (EXC_PCT / 100) * batchSizeGrams);
  add('sodium metabisulphite', (EXC_PCT / 100) * batchSizeGrams);
  if (az) add('edta', (EXC_PCT / 100) * batchSizeGrams);
  // TCS solvent is a flat 3.5% of batch weight; every other formula's
  // solvent stays scaled at 50% of the non-tretinoin actives (in grams here).
  const solventPct = tcs ? TCS_SOLVENT_PCT : (nonTretGrams / batchSizeGrams) * 100 * 0.5;
  const solventGrams = (solventPct / 100) * batchSizeGrams;
  if (tcs) add('propylene glycol', solventGrams);
  else add('transcutol-p', solventGrams);
  const usedPct =
    apiList.reduce((s, i) => s + i.percent, 0) +
    EXC_PCT * 2 +
    (az ? EXC_PCT : 0) +
    solventPct;
  add('cream base', (Math.max(0, 100 - usedPct) / 100) * batchSizeGrams);
  return d;
}

export function foamDeduction(apiList, batchSizeGrams = 50) {
  const d = {};
  let used = 0;
  apiList.forEach((api) => {
    const g = (api.percent / 100) * batchSizeGrams;
    d[norm(api.name)] = (d[norm(api.name)] || 0) + g;
    used += api.percent;
  });
  d['polysorbate'] = (d['polysorbate'] || 0) + (FOAM_POLYSORBATE_PCT / 100) * batchSizeGrams;
  used += FOAM_POLYSORBATE_PCT;
  d['foam base'] = (d['foam base'] || 0) + (Math.max(0, 100 - used) / 100) * batchSizeGrams;
  return d;
}

export function mergeDeductions(maps) {
  const m = {};
  maps.forEach((x) => {
    Object.keys(x).forEach((k) => {
      m[k] = (m[k] || 0) + x[k];
    });
  });
  return m;
}

// ── Default reference data (seed values for a fresh install) ──
export const DEFAULT_APIS = [
  { name: 'Tretinoin', code: 'TRE', type: 'API' },
  { name: 'Azelaic Acid', code: 'AZA', type: 'API' },
  { name: 'Niacinamide', code: 'NIA', type: 'API' },
  { name: 'Spironolactone', code: 'SPIRO', type: 'API' },
  { name: 'Clindamycin', code: 'CLIN', type: 'API' },
  { name: 'Minoxidil', code: 'MINO', type: 'API' },
  { name: 'Tranexamic Acid', code: 'TXA', type: 'API' },
  { name: 'Kojic Acid', code: 'KOJ', type: 'API' },
  { name: 'Hydroquinone', code: 'HQ', type: 'API' },
  { name: 'Hyaluronic Acid', code: 'HA', type: 'API' },
  { name: 'Adapalene', code: 'ADA', type: 'API' },
  { name: 'Benzoyl Peroxide', code: 'BPO', type: 'API' },
  { name: 'Hydrocortisone', code: 'HC', type: 'API' },
  { name: 'Alpha Arbutin', code: 'AA', type: 'API' },
  { name: 'Ivermectin', code: 'IVM', type: 'API' },
  { name: 'Metronidazole', code: 'MTZ', type: 'API' },
  { name: 'Sodium Metabisulphite', code: 'SMBS', type: 'EXC' },
  { name: 'BHT', code: 'BHT', type: 'EXC' },
  { name: 'Disodium EDTA', code: 'EDTA', type: 'EXC' },
  { name: 'Transcutol-P', code: 'TCP', type: 'EXC' },
  { name: 'Propylene Glycol', code: 'PG', type: 'EXC' },
  { name: 'Cream Base', code: 'CB', type: 'BASE' },
  { name: 'Foam Base', code: 'FB', type: 'BASE' },
].map((i) => ({ ...i, stock: 0, bought: 0, price: 0, restock: '' }));

export const DEFAULT_CREAM_BASE = [
  { name: 'DM Water', code: 'DMW', pct: 82.2 },
  { name: 'Glycerin', code: 'GLY', pct: 2 },
  { name: 'Hyaluronic Acid', code: 'HA-C', pct: 0.5 },
  { name: 'Carbopol', code: 'CARB', pct: 1.3 },
  { name: 'Triethanolamine', code: 'TEA', pct: 1 },
  { name: 'Isopropyl Palmitate', code: 'IPP', pct: 2 },
  { name: 'Isopropyl Myristate', code: 'IPM', pct: 2 },
  { name: 'Olivem', code: 'OLV', pct: 2 },
  { name: 'Emulsifying Wax', code: 'EWAX', pct: 2 },
  { name: 'Dimethicone', code: 'DMTC', pct: 0.8 },
  { name: 'Cetiol', code: 'CTL', pct: 1 },
  { name: 'PhenHEG', code: 'PHG', pct: 0.5 },
  { name: 'Vitamin E', code: 'VTE', pct: 0.5 },
  { name: 'Sorbic Acid', code: 'SBA', pct: 0.2 },
  { name: 'Panthenol', code: 'PANT', pct: 1 },
  { name: 'Licorice Extract', code: 'LIC', pct: 1 },
].map((i) => ({ ...i, stock: 0, bought: 0, price: 0, restock: '' }));

export const DEFAULT_FOAM_BASE = [
  { name: 'DM Water', code: 'DMW', pct: 68.5 },
  { name: 'Decyl Glucoside', code: 'DG', pct: 4 },
  { name: 'Glycerin', code: 'GLY', pct: 2 },
  { name: 'Propanediol', code: 'PDO', pct: 7 },
  { name: 'Sodium Lactate', code: 'SLA', pct: 0.5 },
  { name: 'Lactic Acid', code: 'LA', pct: 4 },
  { name: 'Pea Sprout Extract', code: 'PSE', pct: 0.5 },
  { name: 'Panthenol', code: 'PANT', pct: 0.8 },
  { name: 'Polyquaternium-10', code: 'PQ10', pct: 0.6 },
  { name: 'Polyquaternium-7', code: 'PQ7', pct: 0.6 },
  { name: 'Phenoxyethanol', code: 'PHE', pct: 0.8 },
  { name: 'Sodium Benzoate', code: 'SBZ', pct: 0.4 },
  { name: 'Denatured Ethanol', code: 'ETH', pct: 10 },
  { name: 'Zinc PCA', code: 'ZPCA', pct: 0.1 },
  { name: 'Sodium Metabisulfite', code: 'SMBS', pct: 0.1 },
  { name: 'Disodium EDTA', code: 'EDTA', pct: 0.1 },
  { name: 'BHT', code: 'BHT', pct: 0.1 },
  { name: 'Sorbic Acid', code: 'SBA', pct: 0.2 },
].map((i) => ({ ...i, stock: 0, bought: 0, price: 0, restock: '' }));

export const DEFAULT_PACKAGING = [
  { name: '15ml pump', kit: '20g', custType: 'repeat' },
  { name: 'Flyer (small)', kit: '20g', custType: 'repeat' },
  { name: 'Box (small)', kit: '20g', custType: 'repeat' },
  { name: 'Sleeve', kit: '20g', custType: 'repeat' },
  { name: 'Sticker', kit: '20g', custType: 'repeat' },
  { name: '50ml pump', kit: '50g', custType: 'repeat' },
  { name: 'Flyer (big)', kit: '50g', custType: 'repeat' },
  { name: 'Box (big)', kit: '50g', custType: 'repeat' },
  { name: 'Foam pump', kit: 'foam', custType: 'repeat' },
  { name: 'Card', kit: '20g', custType: 'new' },
  { name: 'Brochure', kit: '20g', custType: 'new' },
  { name: 'Glass bottle', kit: '20g', custType: 'new' },
].map((i) => ({ ...i, stock: 0, price: 0, restock: '' }));
