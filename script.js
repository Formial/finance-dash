// Formial Finance dashboard — vanilla JS, data kept in localStorage.
// Per-month record: rx counts (new/refill x cream20/cream50/foam),
// COGS components, optional manual COGS override, a justification note.
// Ledger: R&D / Marketing / Others expenses with dates.
(function () {
  const KEY = 'formial_finance_v1';
  const PUMPS = [['new', 'New pumps'], ['refill', 'Refill pumps'], ['lotion', 'Lotion'], ['foam', 'Foam']];
  const PCOL = { new: 'var(--c1)', refill: 'var(--c3)', lotion: 'var(--c2)', foam: 'var(--c4)' };
  const DEFAULT_UNIT = { new: { pack: '', api: '' }, refill: { pack: '', api: '' }, lotion: { pack: '', api: '' }, foam: { pack: '', api: '' } };
  const CATS = ['R&D', 'Marketing', 'Others'];
  const COLORS = { rx: 'var(--c1)', 'R&D': 'var(--c2)', Marketing: 'var(--c3)', Others: 'var(--c4)' };
  const $ = (id) => document.getElementById(id);
  const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const num = (v) => (isFinite(+v) ? +v : 0);

  // Every state we accept (browser cache, server, import, sync) goes through here.
  function normalize(s) {
    s = s && typeof s === 'object' ? s : {};
    s.months = s.months && typeof s.months === 'object' ? s.months : {};
    s.ledger = Array.isArray(s.ledger) ? s.ledger : [];
    const u = s.unitCosts || {};
    s.unitCosts = {};
    PUMPS.forEach(([k]) => { s.unitCosts[k] = Object.assign({}, DEFAULT_UNIT[k], u[k]); });
    return s;
  }
  let state = normalize({});
  try { state = normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}

  const online = window.location.protocol.startsWith('http');
  const cache = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  // Password gate: the deployed site is public, so the API answers 401 until
  // the person has entered the dashboard password (cookie lasts 30 days).
  let loginWait = null;
  function askLogin() {
    if (loginWait) return loginWait;
    const box = $('login'), form = $('loginForm'), pw = $('loginPw'), err = $('loginErr');
    box.hidden = false; pw.value = ''; pw.focus();
    loginWait = new Promise((resolve) => {
      form.onsubmit = async (e) => {
        e.preventDefault();
        err.textContent = '';
        try {
          const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
          if (r.ok) { box.hidden = true; loginWait = null; resolve(true); return; }
          err.textContent = (await r.json().catch(() => ({}))).error || 'Login failed';
        } catch (x) { err.textContent = 'Server unreachable'; }
        pw.select();
      };
    });
    return loginWait;
  }
  async function api(path, opts) {
    let res = await fetch(path, opts);
    if (res.status === 401) { await askLogin(); res = await fetch(path, opts); }
    return res;
  }

  // Saves are debounced: every keystroke updates the page instantly, the
  // server copy follows once typing pauses.
  let saveTimer = null;
  const save = () => {
    cache();
    if (!online) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const r = await api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
        if (!r.ok) console.warn('Save failed: HTTP ' + r.status);
      } catch (e) { console.warn('Save failed:', e.message); }
    }, 600);
  };

  const today = new Date();
  let cur = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');

  const shift = (m, d) => { const [y, mo] = m.split('-').map(Number); const dt = new Date(y, mo - 1 + d, 1); return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); };
  const label = (m, long) => new Date(m + '-01T00:00').toLocaleString('en-IN', { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit' });
  const rec = (m) => state.months[m] || {};

  // ---- calculations -------------------------------------------------------
  // COGS = Rx cost (pumps x saved cost per pump) + manual usage (R&D + marketing + others ledger).
  function calc(m) {
    const r = rec(m), pu = r.pumps || {};
    const counts = {}, unit = {}, cost = {};
    let total = 0, computed = 0;
    PUMPS.forEach(([k]) => {
      const u = state.unitCosts[k] || {};
      counts[k] = num(pu[k]); unit[k] = num(u.pack) + num(u.api); cost[k] = counts[k] * unit[k];
      total += counts[k]; computed += cost[k];
    });
    const overridden = r.override !== undefined && r.override !== null && r.override !== '';
    const rxCost = overridden ? num(r.override) : computed;
    const exp = { 'R&D': 0, Marketing: 0, Others: 0 };
    state.ledger.forEach((e) => { if (e.date && e.date.slice(0, 7) === m && exp[e.cat] !== undefined) exp[e.cat] += num(e.amt); });
    const manual = exp['R&D'] + exp.Marketing + exp.Others;
    const cogs = rxCost + manual;
    return { total, counts, unit, cost, computed, overridden, rxCost, exp, manual, cogs, perRx: total ? cogs / total : 0, has: !!(total || rxCost || manual) };
  }

  // ---- rendering ----------------------------------------------------------
  function delta(cur, prev, lowerBetter) {
    if (!prev) return '<div class="d">&nbsp;</div>';
    const p = ((cur - prev) / prev) * 100; if (!isFinite(p)) return '<div class="d">&nbsp;</div>';
    const bad = lowerBetter ? p > 0 : p < 0;
    return `<div class="d ${bad ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}% vs last month</div>`;
  }

  function renderKpis(c, p) {
    const items = [
      ['Prescriptions', c.total.toLocaleString('en-IN'), delta(c.total, p.total)],
      ['Rx cost', inr(c.rxCost), delta(c.rxCost, p.rxCost, true) + (c.overridden ? '<div class="d">manual override</div>' : '')],
      ['Manual usage', inr(c.manual), delta(c.manual, p.manual, true)],
      ['Total COGS', inr(c.cogs), delta(c.cogs, p.cogs, true)],
      ['COGS per Rx', inr(c.perRx), delta(c.perRx, p.perRx, true)],
    ];
    $('kpis').innerHTML = items.map(([l, v, d]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${d}</div>`).join('');
  }

  function barSvg(w, h, cols, fmtVal) {
    // cols: [{label, segs:[{v,color}], sel}]
    const pad = { l: 8, r: 8, t: 20, b: 26 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const max = Math.max(1, ...cols.map((c) => c.segs.reduce((s, x) => s + x.v, 0)));
    const bw = Math.min(56, (iw / cols.length) * 0.6), step = iw / cols.length;
    let out = `<svg viewBox="0 0 ${w} ${h}" role="img"><line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="#BFE6FF"/>`;
    cols.forEach((c, i) => {
      const x = pad.l + step * i + (step - bw) / 2; let y = pad.t + ih; const tot = c.segs.reduce((s, z) => s + z.v, 0);
      c.segs.forEach((s) => { const sh = (s.v / max) * ih; y -= sh; if (sh > 0) out += `<rect x="${x}" y="${y}" width="${bw}" height="${sh}" rx="2" fill="${s.color}"><title>${s.name || ''} ${fmtVal(s.v)}</title></rect>`; });
      out += `<text class="val" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${tot ? fmtVal(tot) : ''}</text>`;
      out += `<text class="${c.sel ? 'sel' : ''}" x="${x + bw / 2}" y="${h - 8}" text-anchor="middle">${c.label}</text>`;
    });
    return out + '</svg>';
  }

  function renderRx(c) {
    $('rxSub').textContent = label(cur, true);
    if (!c.total) { $('rxChart').innerHTML = '<div class="empty">No prescriptions entered for this month.</div>'; return; }
    const cols = PUMPS.map(([k, n]) => ({ label: n, segs: [{ v: c.counts[k], color: PCOL[k], name: n }] }));
    $('rxChart').innerHTML = barSvg(480, 230, cols, (v) => v.toLocaleString('en-IN'));
  }

  function renderCost(c) {
    $('costSub').textContent = label(cur, true);
    const pct = (v) => (c.cogs ? ((v / c.cogs) * 100).toFixed(1) + '%' : '–');
    const row = (n, v, cls) => `<tr class="${cls || ''}"><td>${n}</td><td class="n">${inr(v)}</td><td class="n">${pct(v)}</td></tr>`;
    $('costTable').innerHTML = `<tr><th>Item</th><th class="n">Amount</th><th class="n">Share</th></tr>
      <tr class="grp"><td colspan="3">Rx cost (pumps × cost per pump)</td></tr>
      ${PUMPS.map(([k, n]) => row(`${n} · ${c.counts[k].toLocaleString('en-IN')} × ${inr(c.unit[k])}`, c.cost[k])).join('')}
      ${row('Rx cost' + (c.overridden ? ' (manual override; computed ' + inr(c.computed) + ')' : ''), c.rxCost, 'tot')}
      <tr class="grp"><td colspan="3">Manual usage</td></tr>
      ${CATS.map((k) => row(k, c.exp[k])).join('')}
      ${row('Manual usage', c.manual, 'tot')}
      ${row('Total COGS', c.cogs, 'tot')}`;
  }

  let view = 'category';
  function renderOverall() {
    const months = Object.keys(state.months).concat(state.ledger.map((e) => (e.date || '').slice(0, 7))).filter(Boolean);
    months.push(cur);
    const sorted = [...new Set(months)].sort().slice(-12);
    const data = sorted.map((m) => ({ m, c: calc(m) }));
    let cols, legend;
    if (view === 'category') {
      cols = data.map(({ m, c }) => ({ label: label(m), sel: m === cur, segs: [{ v: c.rxCost, color: COLORS.rx, name: 'Rx cost' }, ...CATS.map((k) => ({ v: c.exp[k], color: COLORS[k], name: k }))] }));
      legend = [['Rx cost', COLORS.rx], ...CATS.map((k) => [k, COLORS[k]])];
    } else if (view === 'product') {
      cols = data.map(({ m, c }) => ({ label: label(m), sel: m === cur, segs: PUMPS.map(([k, n]) => ({ v: c.cost[k], color: PCOL[k], name: n })) }));
      legend = PUMPS.map(([k, n]) => [n, PCOL[k]]);
    } else {
      cols = data.map(({ m, c }) => ({ label: label(m), sel: m === cur, segs: [{ v: c.perRx, color: 'var(--c1)', name: 'COGS per Rx' }] }));
      legend = [['COGS per Rx', 'var(--c1)']];
    }
    $('overall').innerHTML = data.some(({ c }) => c.has) ? barSvg(Math.max(640, data.length * 90), 280, cols, inr) : '<div class="empty">Enter pump counts to see the monthly cost trend.</div>';
    $('legend').innerHTML = legend.map(([n, col]) => `<span><i style="background:${col}"></i>${n}</span>`).join('');
  }

  function renderAnalysis(c, p) {
    $('anaSub').textContent = label(cur, true) + ' vs ' + label(shift(cur, -1), true);
    if (!c.has) { $('analysis').innerHTML = '<div class="empty">No data for this month yet.</div>'; return; }
    const lines = [];
    if (p.has && p.perRx && c.perRx) {
      const d = c.perRx - p.perRx, pc = (d / p.perRx) * 100;
      lines.push(`COGS per Rx went <b>${d >= 0 ? 'up' : 'down'}</b> from ${inr(p.perRx)} to ${inr(c.perRx)} (${pc >= 0 ? '+' : ''}${pc.toFixed(1)}%).`);
      const refillShare = (x) => (x.total ? (x.counts.refill / x.total) * 100 : 0);
      lines.push(`Refill share of pumps: ${refillShare(p).toFixed(0)}% → ${refillShare(c).toFixed(0)}%.`);
      const comps = [...PUMPS.map(([k, n]) => [n + ' cost', c.cost[k] - p.cost[k]]), ...CATS.map((k) => [k, c.exp[k] - p.exp[k]])].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      if (comps[0] && comps[0][1]) lines.push(`Biggest mover in COGS: <b>${comps[0][0]}</b> (${comps[0][1] >= 0 ? '+' : '−'}${inr(Math.abs(comps[0][1]))}).`);
    } else lines.push('No previous month to compare against.');
    if (c.overridden) lines.push(`Rx cost is manually fixed at ${inr(c.rxCost)}; from pump counts it would be ${inr(c.computed)}.`);
    $('analysis').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  }

  function renderForm() {
    const r = rec(cur), pu = r.pumps || {};
    const f = (id, lbl, val, ph) => `<label class="fld"><span>${lbl}</span><input type="number" min="0" step="any" data-k="${id}" value="${val ?? ''}" placeholder="${ph || '0'}"></label>`;
    $('form').innerHTML =
      '<h3>Pumps this month</h3>' + PUMPS.map(([k, n]) => f('pumps.' + k, n, pu[k])).join('') +
      '<h3>Rx cost</h3>' + f('override', 'Fix Rx cost manually (₹)', r.override, 'auto');
    $('note').value = r.note || '';
  }

  // Cost per pump: saved once, applied to every month.
  function renderUnits() {
    const inp = (k, f) => `<input type="number" min="0" step="any" data-u="${k}.${f}" value="${state.unitCosts[k][f] ?? ''}" placeholder="0" aria-label="${k} ${f}">`;
    $('units').innerHTML = '<tr><th>Pump type</th><th class="n">Packaging ₹</th><th class="n">API ₹</th><th class="n">Total ₹</th></tr>' +
      PUMPS.map(([k, n]) => `<tr><td>${n}</td><td>${inp(k, 'pack')}</td><td>${inp(k, 'api')}</td><td class="n" data-tot="${k}">${inr(num(state.unitCosts[k].pack) + num(state.unitCosts[k].api))}</td></tr>`).join('');
  }

  function renderLedger() {
    $('ledSub').textContent = label(cur, true);
    const rows = state.ledger.map((e, i) => [e, i]).filter(([e]) => (e.date || '').slice(0, 7) === cur).sort((a, b) => a[0].date.localeCompare(b[0].date));
    $('ledger').innerHTML = rows.length
      ? '<tr><th>Date</th><th>Type</th><th>Description</th><th class="n">₹</th><th></th></tr>' + rows.map(([e, i]) => `<tr><td>${e.date.slice(8)}/${e.date.slice(5, 7)}</td><td>${e.cat}</td><td>${esc(e.desc)}</td><td class="n">${inr(e.amt)}</td><td><button class="del" data-i="${i}" aria-label="Delete">×</button></td></tr>`).join('')
      : '<tr><td class="empty">No R&amp;D / marketing / other expenses this month.</td></tr>';
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function render(skipForm) {
    $('month').value = cur;
    const c = calc(cur), p = calc(shift(cur, -1));
    renderKpis(c, p); renderRx(c); renderCost(c); renderOverall(); renderAnalysis(c, p); renderLedger();
    if (!skipForm) { renderForm(); renderUnits(); }
    $('lDate').value = $('lDate').value && $('lDate').value.slice(0, 7) === cur ? $('lDate').value : cur + '-01';
  }

  // ---- events -------------------------------------------------------------
  $('month').onchange = (e) => { if (e.target.value) { cur = e.target.value; render(); } };
  $('prev').onclick = () => { cur = shift(cur, -1); render(); };
  $('next').onclick = () => { cur = shift(cur, 1); render(); };
  $('viewSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; view = b.dataset.v; [...$('viewSeg').children].forEach((x) => x.classList.toggle('on', x === b)); renderOverall(); };
  $('form').oninput = (e) => {
    const k = e.target.dataset.k; if (!k) return;
    const r = (state.months[cur] = state.months[cur] || {});
    const v = e.target.value;
    const path = k.split('.');
    if (path.length === 2) { r[path[0]] = r[path[0]] || {}; r[path[0]][path[1]] = v; } else r[k] = v;
    save(); render(true);
  };
  $('units').oninput = (e) => {
    const k = e.target.dataset.u; if (!k) return;
    const [t, f] = k.split('.');
    state.unitCosts[t][f] = e.target.value;
    const cell = document.querySelector('[data-tot="' + t + '"]');
    if (cell) cell.textContent = inr(num(state.unitCosts[t].pack) + num(state.unitCosts[t].api));
    save(); render(true);
  };
  $('note').oninput = (e) => { (state.months[cur] = state.months[cur] || {}).note = e.target.value; save(); };
  $('ledForm').onsubmit = (e) => {
    e.preventDefault();
    state.ledger.push({ cat: $('lCat').value, date: $('lDate').value, desc: $('lDesc').value.trim(), amt: num($('lAmt').value) });
    $('lDesc').value = ''; $('lAmt').value = ''; save();
    cur = state.ledger[state.ledger.length - 1].date.slice(0, 7); render();
  };
  $('ledger').onclick = (e) => { const b = e.target.closest('.del'); if (!b) return; state.ledger.splice(+b.dataset.i, 1); save(); render(true); };
  $('export').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })); a.download = 'formial-finance.json'; a.click(); };
  $('import').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then((t) => { const d = JSON.parse(t); if (d && d.months && Array.isArray(d.ledger)) { state = normalize(d); save(); render(); } else alert('Not a Formial finance export.'); }).catch(() => alert('Could not read that file.'));
  };

  // ---- MongoDB Sync -------------------------------------------------------
  async function syncWithMongo() {
    const btn = $('syncBtn');
    const msg = $('syncMsg');
    if (!btn) return;
    btn.classList.add('syncing');
    const labelEl = btn.querySelector('.btn-label') || btn;
    labelEl.textContent = 'Syncing...';
    if (msg) msg.textContent = '';

    try {
      if (!online) throw new Error('NOSERVER');
      const res = await api('/api/sync', { method: 'POST' });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
      if (result.ok && result.data) {
        state = normalize(result.data);
        cache();
        render();
        if (msg) {
          msg.textContent = `Synced (${result.syncedMonths?.length || 0} mos)`;
          setTimeout(() => { if (msg) msg.textContent = ''; }, 4000);
        }
      } else {
        throw new Error(result.error || 'Sync returned error');
      }
    } catch (err) {
      console.warn('Sync failed:', err);
      if (msg) {
        const offline = err.message === 'NOSERVER' || err instanceof TypeError;
        msg.textContent = offline ? 'Server offline — run npm start, open localhost:3000' : 'Sync failed: ' + err.message;
        setTimeout(() => { if (msg) msg.textContent = ''; }, 8000);
      }
    } finally {
      btn.classList.remove('syncing');
      const labelEl = btn.querySelector('.btn-label') || btn;
      labelEl.textContent = 'Sync MongoDB';
    }
  }

  if ($('syncBtn')) $('syncBtn').onclick = syncWithMongo;

  // On page load, the server's data.json is the source of truth when the
  // server is running (it is saved on every edit). If it's empty but this
  // browser holds data, push the browser's copy up instead of losing it.
  (async function init() {
    render();
    if (!online) return;
    try {
      const res = await api('/api/data');
      if (!res.ok) return;
      const d = await res.json();
      const serverHas = d && d.months && (Object.keys(d.months).length || (d.ledger || []).length);
      if (serverHas) { state = normalize(d); cache(); }
      else if (Object.keys(state.months).length || state.ledger.length) save();
      render();
    } catch (e) {}
  })();
})();

