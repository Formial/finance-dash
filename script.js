// Formial Finance dashboard — vanilla JS, data kept in localStorage.
// Per-month record: rx counts (new/refill x cream20/cream50/foam), revenue,
// COGS components, optional manual COGS override, a justification note.
// Ledger: R&D / Marketing / Others expenses with dates.
(function () {
  const KEY = 'formial_finance_v1';
  const TYPES = [['c20', 'Cream 20g'], ['c50', 'Cream 50g'], ['foam', 'Foam']];
  const CUST = [['new', 'New'], ['refill', 'Refill']];
  const CATS = ['R&D', 'Marketing', 'Others'];
  const COLORS = { cogs: 'var(--c1)', 'R&D': 'var(--c2)', Marketing: 'var(--c3)', Others: 'var(--c4)' };
  const $ = (id) => document.getElementById(id);
  const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const num = (v) => (isFinite(+v) ? +v : 0);

  let state = { months: {}, ledger: [] };
  try { state = Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}

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
  function calc(m) {
    const r = rec(m), rx = r.rx || {};
    let total = 0; const byType = {}, byCust = { new: 0, refill: 0 };
    TYPES.forEach(([t]) => { byType[t] = 0; CUST.forEach(([c]) => { const v = num(rx[c + '_' + t]); byType[t] += v; byCust[c] += v; total += v; }); });
    const cg = r.cogs || {};
    const parts = { cream: num(cg.cream), foam: num(cg.foam), pack: num(cg.pack), manual: num(cg.manual) };
    const computed = parts.cream + parts.foam + parts.pack + parts.manual;
    const overridden = cg.override !== undefined && cg.override !== '' && cg.override !== null;
    const cogs = overridden ? num(cg.override) : computed;
    const exp = { 'R&D': 0, Marketing: 0, Others: 0 };
    state.ledger.forEach((e) => { if (e.date && e.date.slice(0, 7) === m && exp[e.cat] !== undefined) exp[e.cat] += num(e.amt); });
    const opex = exp['R&D'] + exp.Marketing + exp.Others;
    const revenue = num(r.revenue);
    return { total, byType, byCust, parts, computed, overridden, cogs, exp, opex, revenue, perRx: total ? cogs / total : 0, has: !!(total || cogs || opex || revenue) };
  }

  // ---- rendering ----------------------------------------------------------
  function delta(cur, prev, lowerBetter, fmt) {
    if (!prev) return '<div class="d">&nbsp;</div>';
    const p = ((cur - prev) / prev) * 100; if (!isFinite(p)) return '<div class="d">&nbsp;</div>';
    const bad = lowerBetter ? p > 0 : p < 0;
    return `<div class="d ${bad ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}% vs last month</div>`;
  }

  function renderKpis(c, p) {
    const items = [
      ['Prescriptions', c.total.toLocaleString('en-IN'), delta(c.total, p.total)],
      ['Revenue', inr(c.revenue), delta(c.revenue, p.revenue)],
      ['COGS', inr(c.cogs), delta(c.cogs, p.cogs, true) + (c.overridden ? '<div class="d">manual override</div>' : '')],
      ['COGS per Rx', inr(c.perRx), delta(c.perRx, p.perRx, true)],
      ['R&D + Mktg + Others', inr(c.opex), delta(c.opex, p.opex, true)],
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
    const cols = TYPES.map(([t, n]) => ({ label: n, segs: [{ v: c.byCust.new ? num(rec(cur).rx?.['new_' + t]) : 0, color: 'var(--c1)', name: 'New' }, { v: num(rec(cur).rx?.['refill_' + t]), color: 'var(--c3)', name: 'Refill' }] }));
    $('rxChart').innerHTML = barSvg(480, 230, cols, (v) => v.toLocaleString('en-IN')) +
      `<div class="legend"><span><i style="background:var(--c1)"></i>New (${c.byCust.new})</span><span><i style="background:var(--c3)"></i>Refill (${c.byCust.refill})</span></div>`;
  }

  function renderCost(c) {
    $('costSub').textContent = label(cur, true);
    const pct = (v) => (c.cogs + c.opex ? ((v / (c.cogs + c.opex)) * 100).toFixed(1) + '%' : '–');
    const row = (n, v, cls) => `<tr class="${cls || ''}"><td>${n}</td><td class="n">${inr(v)}</td><td class="n">${pct(v)}</td></tr>`;
    $('costTable').innerHTML = `<tr><th>Item</th><th class="n">Amount</th><th class="n">Share</th></tr>
      <tr class="grp"><td colspan="3">COGS ${c.overridden ? '(manual override — computed ' + inr(c.computed) + ')' : ''}</td></tr>
      ${row('Cream ingredients', c.parts.cream)}${row('Foam ingredients', c.parts.foam)}${row('Packaging', c.parts.pack)}${row('Manual usage', c.parts.manual)}
      ${row('COGS total', c.cogs, 'tot')}
      <tr class="grp"><td colspan="3">Operating</td></tr>
      ${CATS.map((k) => row(k, c.exp[k])).join('')}
      ${row('Total cost', c.cogs + c.opex, 'tot')}`;
  }

  let view = 'category';
  function renderOverall() {
    const months = Object.keys(state.months).concat(state.ledger.map((e) => (e.date || '').slice(0, 7))).filter(Boolean);
    months.push(cur);
    const sorted = [...new Set(months)].sort().slice(-12);
    const data = sorted.map((m) => ({ m, c: calc(m) }));
    let cols, fmt = inr, legend;
    if (view === 'category') {
      cols = data.map(({ m, c }) => ({ label: label(m), sel: m === cur, segs: [{ v: c.cogs, color: COLORS.cogs, name: 'COGS' }, ...CATS.map((k) => ({ v: c.exp[k], color: COLORS[k], name: k }))] }));
      legend = [['COGS', COLORS.cogs], ...CATS.map((k) => [k, COLORS[k]])];
    } else if (view === 'product') {
      cols = data.map(({ m, c }) => ({ label: label(m), sel: m === cur, segs: [{ v: c.parts.cream, color: 'var(--c1)', name: 'Cream' }, { v: c.parts.foam, color: 'var(--c2)', name: 'Foam' }, { v: c.parts.pack, color: 'var(--c3)', name: 'Packaging' }, { v: c.parts.manual, color: 'var(--c4)', name: 'Manual usage' }] }));
      legend = [['Cream', 'var(--c1)'], ['Foam', 'var(--c2)'], ['Packaging', 'var(--c3)'], ['Manual usage', 'var(--c4)']];
    } else {
      cols = data.map(({ m, c }) => ({ label: label(m), sel: m === cur, segs: [{ v: c.perRx, color: 'var(--c1)', name: 'COGS per Rx' }] }));
      legend = [['COGS per Rx', 'var(--c1)']];
    }
    $('overall').innerHTML = data.some(({ c }) => c.has) ? barSvg(Math.max(640, data.length * 90), 280, cols, fmt) : '<div class="empty">Enter figures to see the monthly cost trend.</div>';
    $('legend').innerHTML = legend.map(([n, col]) => `<span><i style="background:${col}"></i>${n}</span>`).join('');
  }

  function renderAnalysis(c, p) {
    $('anaSub').textContent = label(cur, true) + ' vs ' + label(shift(cur, -1), true);
    if (!c.has) { $('analysis').innerHTML = '<div class="empty">No data for this month yet.</div>'; return; }
    const lines = [];
    if (p.has && p.perRx && c.perRx) {
      const d = c.perRx - p.perRx, pc = (d / p.perRx) * 100;
      lines.push(`COGS per Rx went <b>${d >= 0 ? 'up' : 'down'}</b> from ${inr(p.perRx)} to ${inr(c.perRx)} (${pc >= 0 ? '+' : ''}${pc.toFixed(1)}%).`);
      const refillShare = (x) => (x.total ? (x.byCust.refill / x.total) * 100 : 0);
      lines.push(`Refill share of Rx: ${refillShare(p).toFixed(0)}% → ${refillShare(c).toFixed(0)}%.`);
      const comps = [['cream ingredients', 'cream'], ['foam ingredients', 'foam'], ['packaging', 'pack'], ['manual usage', 'manual']].map(([n, k]) => [n, c.parts[k] - p.parts[k]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      if (comps[0] && comps[0][1]) lines.push(`Biggest mover in COGS: <b>${comps[0][0]}</b> (${comps[0][1] >= 0 ? '+' : '−'}${inr(Math.abs(comps[0][1]))}).`);
    } else lines.push('No previous month to compare against.');
    if (c.overridden) lines.push(`COGS is manually fixed at ${inr(c.cogs)}; computed from components it would be ${inr(c.computed)}.`);
    if (c.revenue) lines.push(`Gross margin after COGS: ${(((c.revenue - c.cogs) / c.revenue) * 100).toFixed(1)}%.`);
    $('analysis').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  }

  function renderForm() {
    const r = rec(cur), rx = r.rx || {}, cg = r.cogs || {};
    const f = (id, lbl, val, ph) => `<label class="fld"><span>${lbl}</span><input type="number" min="0" step="any" data-k="${id}" value="${val ?? ''}" placeholder="${ph || '0'}"></label>`;
    $('form').innerHTML =
      CUST.map(([c, cn]) => `<h3>${cn} customers — Rx count</h3>` + TYPES.map(([t, tn]) => f('rx.' + c + '_' + t, tn, rx[c + '_' + t])).join('')).join('') +
      '<h3>Revenue</h3>' + f('revenue', 'Revenue (₹)', r.revenue) +
      '<h3>COGS (₹)</h3>' + f('cogs.cream', 'Cream ingredients', cg.cream) + f('cogs.foam', 'Foam ingredients', cg.foam) + f('cogs.pack', 'Packaging', cg.pack) + f('cogs.manual', 'Manual usage', cg.manual) +
      f('cogs.override', 'Fix COGS manually', cg.override, 'auto') ;
    $('note').value = r.note || '';
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
    if (!skipForm) renderForm();
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
    f.text().then((t) => { const d = JSON.parse(t); if (d && d.months && Array.isArray(d.ledger)) { state = d; save(); render(); } else alert('Not a Formial finance export.'); }).catch(() => alert('Could not read that file.'));
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
        state = result.data;
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
      if (serverHas) { state = { months: d.months, ledger: d.ledger || [] }; cache(); }
      else if (Object.keys(state.months).length || state.ledger.length) save();
      render();
    } catch (e) {}
  })();
})();

