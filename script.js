// Formial Finance dashboard — vanilla JS, data kept in localStorage & MongoDB.
// Per-month record: rx counts (new/refill x cream20/cream50/foam),
// COGS components, old packaging support, optional manual COGS override, a justification note.
// Ledger: R&D / Marketing / Others expenses with dates.
(function () {
  const KEY = 'formial_finance_v1';
  const ALL_PUMPS = [
    ['old', 'Old pumps'],
    ['new', 'New pumps'],
    ['refill', 'Refill pumps'],
    ['lotion', 'Lotion'],
    ['foam', 'Foam']
  ];
  const PCOL = { old: '#64748b', new: 'var(--c1)', refill: 'var(--c3)', lotion: 'var(--c2)', foam: 'var(--c4)' };
  const DEFAULT_UNIT = { old: { pack: '', api: '' }, new: { pack: '', api: '' }, refill: { pack: '', api: '' }, lotion: { pack: '', api: '' }, foam: { pack: '', api: '' } };
  const CATS = ['R&D', 'Marketing', 'Others'];
  const COLORS = { rx: 'var(--c1)', 'R&D': 'var(--c2)', Marketing: 'var(--c3)', Others: 'var(--c4)' };
  const $ = (id) => document.getElementById(id);
  const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const num = (v) => (isFinite(+v) ? +v : 0);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // Every state we accept (browser cache, server, import, sync) goes through here.
  function normalize(s) {
    s = s && typeof s === 'object' ? s : {};
    s.months = s.months && typeof s.months === 'object' ? s.months : {};
    s.ledger = Array.isArray(s.ledger) ? s.ledger : [];
    const u = s.unitCosts || {};
    s.unitCosts = {};
    ALL_PUMPS.forEach(([k]) => { s.unitCosts[k] = Object.assign({}, DEFAULT_UNIT[k], u[k]); });
    return s;
  }
  let state = normalize({});
  try { state = normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}

  const online = window.location.protocol.startsWith('http');
  const cache = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  // Password gate
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

  // Saves debounced
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

    ALL_PUMPS.forEach(([k]) => {
      // Do not keep old pumps for months after August 2026
      if (k === 'old' && m > '2026-08') {
        counts[k] = 0;
        unit[k] = 0;
        cost[k] = 0;
        return;
      }
      counts[k] = num(pu[k]);
      total += counts[k];
      const u = state.unitCosts[k] || {};
      unit[k] = num(u.pack) + num(u.api);
      cost[k] = counts[k] * unit[k];
      computed += cost[k];
    });

    // Fallback if someone entered lump-sum old costs and 0 old pump counts:
    const hasDirectOld = (m <= '2026-08') && !counts.old && (
      (r.oldPackCost !== undefined && r.oldPackCost !== null && r.oldPackCost !== '') ||
      (r.oldIngCost !== undefined && r.oldIngCost !== null && r.oldIngCost !== '')
    );
    if (hasDirectOld) {
      cost.old = num(r.oldPackCost) + num(r.oldIngCost);
      computed += cost.old;
    }

    const overridden = r.override !== undefined && r.override !== null && r.override !== '';
    const rxCost = overridden ? num(r.override) : computed;
    const exp = { 'R&D': 0, Marketing: 0, Others: 0 };
    state.ledger.forEach((e) => { if (e.date && e.date.slice(0, 7) === m && exp[e.cat] !== undefined) exp[e.cat] += num(e.amt); });
    const manual = exp['R&D'] + exp.Marketing + exp.Others;
    const cogs = rxCost + manual;
    return {
      total,
      counts,
      unit,
      cost,
      computed,
      overridden,
      rxCost,
      exp,
      manual,
      cogs,
      has: !!(total || rxCost || manual)
    };
  }

  // ---- rendering ----------------------------------------------------------
  function delta(cur, prev, lowerBetter) {
    if (!prev) return '<div class="d">&nbsp;</div>';
    const p = ((cur - prev) / prev) * 100; if (!isFinite(p)) return '<div class="d">&nbsp;</div>';
    const bad = lowerBetter ? p > 0 : p < 0;
    return `<div class="d ${bad ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}% vs last month</div>`;
  }

  // Dashboard KPI cards: exactly 4 metrics (Pres, Rx cost, Manual usage, Total COGS)
  function renderKpis(c, p) {
    const items = [
      ['Prescriptions', c.total.toLocaleString('en-IN'), delta(c.total, p.total)],
      ['Rx cost', inr(c.rxCost), delta(c.rxCost, p.rxCost, true) + (c.overridden ? '<div class="d">manual override</div>' : '')],
      ['Manual usage', inr(c.manual), delta(c.manual, p.manual, true)],
      ['Total COGS', inr(c.cogs), delta(c.cogs, p.cogs, true)],
    ];
    $('kpis').innerHTML = items.map(([l, v, d]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${d}</div>`).join('');
  }

  function barSvg(w, h, cols, fmtVal) {
    const pad = { l: 8, r: 8, t: 20, b: 26 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const max = Math.max(1, ...cols.map((c) => c.segs.reduce((s, x) => s + x.v, 0)));
    const bw = Math.min(56, (iw / cols.length) * 0.6), step = iw / cols.length;
    let out = `<svg viewBox="0 0 ${w} ${h}" role="img"><line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="#BFE6FF"/>`;
    cols.forEach((c, i) => {
      const x = pad.l + step * i + (step - bw) / 2;
      let y = pad.t + ih;
      const tot = c.segs.reduce((s, z) => s + z.v, 0);
      c.tot = tot;

      let rects = '';
      c.segs.forEach((s, si) => {
        const sh = (s.v / max) * ih;
        y -= sh;
        if (sh > 0) {
          rects += `<rect class="seg-rect" data-si="${si}" data-name="${esc(s.name || '')}" x="${x}" y="${y}" width="${bw}" height="${sh}" rx="2" fill="${s.color}"></rect>`;
        }
      });

      out += `<g class="chart-col ${c.sel ? 'is-selected' : ''}" data-ci="${i}" ${c.month ? `data-month="${c.month}"` : ''}>`;
      out += `<rect class="col-bg" x="${x - 6}" y="${pad.t}" width="${bw + 12}" height="${ih}" rx="4" fill="rgba(0,0,0,0.001)" />`;
      out += rects;
      out += `<text class="val" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${tot ? fmtVal(tot) : ''}</text>`;
      out += `<text class="${c.sel ? 'sel' : ''}" x="${x + bw / 2}" y="${h - 8}" text-anchor="middle">${c.label}</text>`;
      out += `</g>`;
    });
    return out + '</svg>';
  }

  function renderRx(c) {
    $('rxSub').textContent = label(cur, true);
    const chartEl = $('rxChart');
    if (!c.total) {
      chartEl.innerHTML = '<div class="empty">No prescriptions entered for this month.</div>';
      chartEl._chartCols = null;
      return;
    }
    const isPreOrAug = cur <= '2026-08';
    const activePumps = ALL_PUMPS.filter(([k]) => k !== 'old' || isPreOrAug);

    const cols = activePumps.map(([k, n]) => {
      const cnt = c.counts[k] || 0;
      const unitCost = c.unit[k] || 0;
      const totalCost = c.cost[k] || 0;
      const share = c.total > 0 ? ((cnt / c.total) * 100).toFixed(1) + '%' : '0%';
      return {
        label: n,
        fullLabel: `${n} · ${label(cur, true)}`,
        extra: unitCost ? `Rate: ${inr(unitCost)} · Total cost: ${inr(totalCost)} (${share} of prescriptions)` : `${cnt.toLocaleString('en-IN')} Rx (${share})`,
        segs: [{ v: cnt, color: PCOL[k], name: n }]
      };
    });
    chartEl._chartCols = cols;
    chartEl._fmtVal = (v) => v.toLocaleString('en-IN') + ' Rx';
    chartEl.innerHTML = barSvg(480, 230, cols, (v) => v.toLocaleString('en-IN'));
  }

  // Cost breakdown table
  function renderCost(c) {
    $('costSub').textContent = label(cur, true);
    const row = (n, v, cls) => `<tr class="${cls || ''}"><td>${n}</td><td class="n">${inr(v)}</td></tr>`;

    const isPreOrAug = cur <= '2026-08';
    const activePumps = ALL_PUMPS.filter(([k]) => k !== 'old' || isPreOrAug);

    const rxRows = `
      <tr class="grp"><td colspan="2">Rx cost (pumps × cost per pump)</td></tr>
      ${activePumps.map(([k, n]) => row(`${n} · ${c.counts[k].toLocaleString('en-IN')} × ${inr(c.unit[k])}`, c.cost[k])).join('')}
    `;

    $('costTable').innerHTML = `<tr><th>Item</th><th class="n">Amount</th></tr>
      ${rxRows}
      ${row('Rx cost' + (c.overridden ? ' (manual override; computed ' + inr(c.computed) + ')' : ''), c.rxCost, 'tot')}
      <tr class="grp"><td colspan="2">Manual usage</td></tr>
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
      cols = data.map(({ m, c }) => ({
        label: label(m),
        fullLabel: `${label(m, true)} (By Category)`,
        month: m,
        sel: m === cur,
        segs: [
          { v: c.rxCost, color: COLORS.rx, name: 'Rx cost' },
          ...CATS.map((k) => ({ v: c.exp[k], color: COLORS[k], name: k }))
        ]
      }));
      legend = [['Rx cost', COLORS.rx], ...CATS.map((k) => [k, COLORS[k]])];
    } else {
      cols = data.map(({ m, c }) => {
        const isPreOrAug = m <= '2026-08';
        const activePumps = ALL_PUMPS.filter(([k]) => k !== 'old' || isPreOrAug);
        return {
          label: label(m),
          fullLabel: `${label(m, true)} (Rx Cost by Pump)`,
          month: m,
          sel: m === cur,
          segs: activePumps.map(([k, n]) => ({ v: c.cost[k], color: PCOL[k], name: n }))
        };
      });
      const hasOldInView = data.some(({ m }) => m <= '2026-08');
      const legendPumps = ALL_PUMPS.filter(([k]) => k !== 'old' || hasOldInView);
      legend = legendPumps.map(([k, n]) => [n, PCOL[k]]);
    }
    const chartEl = $('overall');
    chartEl._chartCols = cols;
    chartEl._fmtVal = inr;
    chartEl.innerHTML = data.some(({ c }) => c.has) ? barSvg(Math.max(640, data.length * 90), 280, cols, inr) : '<div class="empty">Enter pump counts to see the monthly cost trend.</div>';
    $('legend').innerHTML = legend.map(([n, col]) => `<span data-legend="${esc(n)}"><i style="background:${col}"></i>${n}</span>`).join('');

    renderOverallSummaryTable(data);
  }

  function renderOverallSummaryTable(data) {
    const table = $('overallTable');
    if (!table) return;
    if (!data.length || !data.some(({ c }) => c.has)) {
      table.innerHTML = '<tr><td class="empty">No monthly data available yet.</td></tr>';
      return;
    }
    const rows = data.slice().reverse().map(({ m, c }) => {
      const isSel = m === cur;
      const packBadge = m <= '2026-08' ? '<span class="badge badge-old">Old pumps</span>' : '<span class="badge badge-new">Current pkg</span>';
      return `<tr class="${isSel ? 'tot' : ''}" style="cursor:pointer;" data-selmonth="${m}">
        <td><b>${label(m, true)}</b> ${packBadge}</td>
        <td class="n">${c.total.toLocaleString('en-IN')}</td>
        <td class="n">${inr(c.rxCost)}</td>
        <td class="n">${inr(c.manual)}</td>
        <td class="n">${inr(c.cogs)}</td>
      </tr>`;
    }).join('');

    table.innerHTML = `<tr>
      <th>Month</th>
      <th class="n">Prescriptions</th>
      <th class="n">Rx Cost</th>
      <th class="n">Manual Usage</th>
      <th class="n">Total COGS</th>
    </tr>${rows}`;

    table.querySelectorAll('tr[data-selmonth]').forEach((tr) => {
      tr.onclick = () => {
        cur = tr.dataset.selmonth;
        render();
      };
    });
  }

  // Cost analysis: COGS per Rx comparisons removed
  function renderAnalysis(c, p) {
    $('anaSub').textContent = label(cur, true) + ' vs ' + label(shift(cur, -1), true);
    if (!c.has) { $('analysis').innerHTML = '<div class="empty">No data for this month yet.</div>'; return; }
    const lines = [];
    if (p.has) {
      const d = c.cogs - p.cogs, pc = p.cogs ? (d / p.cogs) * 100 : 0;
      lines.push(`Total COGS went <b>${d >= 0 ? 'up' : 'down'}</b> from ${inr(p.cogs)} to ${inr(c.cogs)} (${pc >= 0 ? '+' : ''}${pc.toFixed(1)}%).`);
      if (p.rxCost || c.rxCost) {
        const rd = c.rxCost - p.rxCost;
        lines.push(`Rx cost changed by <b>${rd >= 0 ? '+' : '−'}${inr(Math.abs(rd))}</b> (${inr(p.rxCost)} → ${inr(c.rxCost)}).`);
      }
      const refillShare = (x) => (x.total ? (x.counts.refill / x.total) * 100 : 0);
      if (c.total || p.total) {
        lines.push(`Refill share of pumps: ${refillShare(p).toFixed(0)}% → ${refillShare(c).toFixed(0)}%.`);
      }
      const activePumps = ALL_PUMPS.filter(([k]) => k !== 'old' || cur <= '2026-08');
      const comps = [...activePumps.map(([k, n]) => [n + ' cost', (c.cost[k] || 0) - (p.cost[k] || 0)]), ...CATS.map((k) => [k, (c.exp[k] || 0) - (p.exp[k] || 0)])].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      if (comps[0] && comps[0][1]) lines.push(`Biggest mover in COGS: <b>${comps[0][0]}</b> (${comps[0][1] >= 0 ? '+' : '−'}${inr(Math.abs(comps[0][1]))}).`);
    } else {
      lines.push('No previous month to compare against.');
    }
    if (c.overridden) lines.push(`Rx cost is manually fixed at ${inr(c.rxCost)}; from pump counts it would be ${inr(c.computed)}.`);
    $('analysis').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');

    const r = rec(cur);
    const noteEl = $('noteDisplay');
    if (noteEl) {
      noteEl.innerHTML = r.note ? `<b>Note for ${label(cur, true)}:</b> ${esc(r.note)}` : '<i>No note entered for this month.</i>';
    }
  }

  // Monthly figures input form: supports Old pumps for months till August
  function renderForm() {
    const r = rec(cur), pu = r.pumps || {};
    const isPreOrAug = cur <= '2026-08';
    const f = (id, lbl, val, ph) => `<label class="fld"><span>${lbl}</span><input type="number" min="0" step="any" data-k="${id}" value="${val ?? ''}" placeholder="${ph || '0'}"></label>`;

    let pumpsHtml = '';
    if (isPreOrAug) {
      pumpsHtml = `
        <div class="fld wide" style="margin-bottom:6px;">
          <span style="font-weight:600;color:var(--primary);font-size:12px;">Months till August: enter Old pumps count; set New &amp; Refill to 0</span>
        </div>
        ${f('pumps.old', 'Old pumps (prescriptions)', pu.old)}
        ${f('pumps.new', 'New pumps', pu.new)}
        ${f('pumps.refill', 'Refill pumps', pu.refill)}
        ${f('pumps.lotion', 'Lotion', pu.lotion)}
        ${f('pumps.foam', 'Foam', pu.foam)}
      `;
    } else {
      pumpsHtml = `
        ${f('pumps.new', 'New pumps', pu.new)}
        ${f('pumps.refill', 'Refill pumps', pu.refill)}
        ${f('pumps.lotion', 'Lotion', pu.lotion)}
        ${f('pumps.foam', 'Foam', pu.foam)}
      `;
    }

    $('form').innerHTML =
      '<h3>Pumps this month</h3>' + pumpsHtml +
      '<h3>Rx cost override</h3>' + f('override', 'Fix Rx cost manually (₹)', r.override, 'auto');
    $('note').value = r.note || '';
  }

  // Cost per pump: shows Old pumps only for months till August 2026
  function renderUnits() {
    const isPreOrAug = cur <= '2026-08';
    const activePumps = ALL_PUMPS.filter(([k]) => k !== 'old' || isPreOrAug);
    const inp = (k, f) => `<input type="number" min="0" step="any" data-u="${k}.${f}" value="${state.unitCosts[k][f] ?? ''}" placeholder="0" aria-label="${k} ${f}">`;
    $('units').innerHTML = '<tr><th>Pump type</th><th class="n">Packaging ₹</th><th class="n">API (Ing) ₹</th><th class="n">Total ₹</th></tr>' +
      activePumps.map(([k, n]) => `<tr><td><b>${n}</b></td><td>${inp(k, 'pack')}</td><td>${inp(k, 'api')}</td><td class="n" data-tot="${k}">${inr(num(state.unitCosts[k].pack) + num(state.unitCosts[k].api))}</td></tr>`).join('');
  }

  function renderLedger() {
    $('ledSub').textContent = label(cur, true);
    if ($('ledStatsSub')) $('ledStatsSub').textContent = label(cur, true);

    const rows = state.ledger.map((e, i) => [e, i]).filter(([e]) => (e.date || '').slice(0, 7) === cur).sort((a, b) => a[0].date.localeCompare(b[0].date));
    
    // Editable ledger on figures view
    $('ledger').innerHTML = rows.length
      ? '<tr><th>Date</th><th>Type</th><th>Description</th><th class="n">₹</th><th></th></tr>' + rows.map(([e, i]) => `<tr><td>${e.date.slice(8)}/${e.date.slice(5, 7)}</td><td>${e.cat}</td><td>${esc(e.desc)}</td><td class="n">${inr(e.amt)}</td><td><button class="del" data-i="${i}" aria-label="Delete">×</button></td></tr>`).join('')
      : '<tr><td class="empty">No R&amp;D / marketing / other expenses this month.</td></tr>';

    // Readonly ledger on stats view
    if ($('ledgerStats')) {
      $('ledgerStats').innerHTML = rows.length
        ? '<tr><th>Date</th><th>Type</th><th>Description</th><th class="n">₹</th></tr>' + rows.map(([e]) => `<tr><td>${e.date.slice(8)}/${e.date.slice(5, 7)}</td><td>${e.cat}</td><td>${esc(e.desc)}</td><td class="n">${inr(e.amt)}</td></tr>`).join('') + `<tr class="tot"><td colspan="3">Total manual usage</td><td class="n">${inr(rows.reduce((s, [e]) => s + num(e.amt), 0))}</td></tr>`
        : '<tr><td class="empty">No expenses recorded for this month.</td></tr>';
    }
  }

  // ---- Chart Tooltips & Interaction ---------------------------------------
  const tooltip = $('chartTooltip');

  function hideTooltip() {
    if (!tooltip) return;
    tooltip.classList.remove('visible');
    tooltip.hidden = true;
    document.querySelectorAll('.chart').forEach((el) => {
      el.classList.remove('has-hover', 'has-legend-hover');
    });
    document.querySelectorAll('.chart-col').forEach((el) => el.classList.remove('is-hovered'));
    document.querySelectorAll('.seg-rect').forEach((el) => el.classList.remove('seg-hovered', 'seg-dimmed'));
  }

  function positionTooltip(e, tip) {
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY - pad;
    const tipRect = tip.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    if (x + tipRect.width > winW - 12) {
      x = e.clientX - tipRect.width - pad;
    }
    if (x < 12) x = 12;

    if (y + tipRect.height > winH - 12) {
      y = e.clientY - tipRect.height - pad;
    }
    if (y < 12) y = 12;

    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function setupChartTooltips(chartContainer) {
    if (!chartContainer) return;
    chartContainer.addEventListener('pointermove', (e) => {
      const colEl = e.target.closest('.chart-col');
      if (!colEl || !chartContainer._chartCols) {
        hideTooltip();
        return;
      }

      const ci = +colEl.dataset.ci;
      const col = chartContainer._chartCols[ci];
      if (!col) {
        hideTooltip();
        return;
      }

      chartContainer.classList.add('has-hover');
      chartContainer.querySelectorAll('.chart-col').forEach((el) => {
        el.classList.toggle('is-hovered', el === colEl);
      });

      const segEl = e.target.closest('.seg-rect');
      const hoveredSi = segEl ? +segEl.dataset.si : null;
      chartContainer.querySelectorAll('.seg-rect').forEach((el) => {
        el.classList.toggle('seg-hovered', el === segEl);
      });

      const fmtVal = chartContainer._fmtVal || inr;
      const tot = col.tot !== undefined ? col.tot : col.segs.reduce((s, z) => s + z.v, 0);

      const listHtml = col.segs
        .map((s, idx) => {
          const isHov = hoveredSi === idx;
          const pct = tot > 0 ? ((s.v / tot) * 100).toFixed(1) + '%' : '';
          return `
            <div class="tip-item ${isHov ? 'tip-item-hovered' : ''}">
              <span class="tip-dot" style="background:${s.color}"></span>
              <span class="tip-name">${esc(s.name)}</span>
              <span class="tip-val">${fmtVal(s.v)}</span>
              ${pct ? `<span class="tip-pct">${pct}</span>` : ''}
            </div>
          `;
        })
        .join('');

      tooltip.innerHTML = `
        <div class="tip-header">
          <span class="tip-title">${esc(col.fullLabel || col.label)}</span>
          <span class="tip-total">${tot ? fmtVal(tot) : '0'}</span>
        </div>
        <div class="tip-divider"></div>
        <div class="tip-list">${listHtml}</div>
        ${col.extra ? `<div class="tip-extra">${esc(col.extra)}</div>` : ''}
        ${col.month ? `<div class="tip-foot">Click bar to select month</div>` : ''}
      `;

      tooltip.hidden = false;
      tooltip.classList.add('visible');
      positionTooltip(e, tooltip);
    });

    chartContainer.addEventListener('pointerleave', hideTooltip);

    chartContainer.addEventListener('click', (e) => {
      const colEl = e.target.closest('.chart-col');
      if (!colEl) return;
      const month = colEl.dataset.month;
      if (month && month !== cur) {
        hideTooltip();
        cur = month;
        render();
      }
    });
  }

  // Left sidebar navigation: 3 views
  let activeTab = localStorage.getItem('formial_tab') || 'overall';
  function setTab(tab) {
    hideTooltip();
    activeTab = tab;
    try { localStorage.setItem('formial_tab', tab); } catch (e) {}
    $('sideNav').querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    $('panelOverall').classList.toggle('active', tab === 'overall');
    $('panelMonthlyStats').classList.toggle('active', tab === 'monthly-stats');
    $('panelMonthlyFigures').classList.toggle('active', tab === 'monthly-figures');
  }

  function render(skipForm) {
    $('month').value = cur;
    const moText = label(cur, true);
    if ($('statsMonthLabel')) $('statsMonthLabel').textContent = moText;
    if ($('figuresMonthLabel')) $('figuresMonthLabel').textContent = moText;
    if ($('figSub')) $('figSub').textContent = moText;

    const c = calc(cur), p = calc(shift(cur, -1));
    renderKpis(c, p);
    renderRx(c);
    renderCost(c);
    renderOverall();
    renderAnalysis(c, p);
    renderLedger();
    if (!skipForm) {
      renderForm();
      renderUnits();
    }
    $('lDate').value = $('lDate').value && $('lDate').value.slice(0, 7) === cur ? $('lDate').value : cur + '-01';
  }

  // ---- events -------------------------------------------------------------
  $('sideNav').onclick = (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    setTab(btn.dataset.tab);
  };

  $('month').onchange = (e) => { if (e.target.value) { hideTooltip(); cur = e.target.value; render(); } };
  $('prev').onclick = () => { hideTooltip(); cur = shift(cur, -1); render(); };
  $('next').onclick = () => { hideTooltip(); cur = shift(cur, 1); render(); };

  $('viewSeg').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    hideTooltip();
    view = b.dataset.v;
    [...$('viewSeg').children].forEach((x) => x.classList.toggle('on', x === b));
    renderOverall();
  };

  $('form').oninput = (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const r = (state.months[cur] = state.months[cur] || {});
    const v = e.target.value;
    const path = k.split('.');
    if (path.length === 2) {
      r[path[0]] = r[path[0]] || {};
      r[path[0]][path[1]] = v;
    } else {
      r[k] = v;
    }
    save();
    render(true);
  };

  $('units').oninput = (e) => {
    const k = e.target.dataset.u;
    if (!k) return;
    const [t, f] = k.split('.');
    state.unitCosts[t][f] = e.target.value;
    const cell = document.querySelector('[data-tot="' + t + '"]');
    if (cell) cell.textContent = inr(num(state.unitCosts[t].pack) + num(state.unitCosts[t].api));
    save();
    render(true);
  };

  $('note').oninput = (e) => {
    (state.months[cur] = state.months[cur] || {}).note = e.target.value;
    save();
    const noteEl = $('noteDisplay');
    if (noteEl) noteEl.innerHTML = e.target.value ? `<b>Note for ${label(cur, true)}:</b> ${esc(e.target.value)}` : '<i>No note entered for this month.</i>';
  };

  $('ledForm').onsubmit = (e) => {
    e.preventDefault();
    state.ledger.push({ cat: $('lCat').value, date: $('lDate').value, desc: $('lDesc').value.trim(), amt: num($('lAmt').value) });
    $('lDesc').value = ''; $('lAmt').value = '';
    save();
    cur = state.ledger[state.ledger.length - 1].date.slice(0, 7);
    render();
  };

  $('ledger').onclick = (e) => {
    const b = e.target.closest('.del');
    if (!b) return;
    state.ledger.splice(+b.dataset.i, 1);
    save();
    render(true);
  };

  $('export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    a.download = 'formial-finance.json';
    a.click();
  };

  $('import').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((t) => {
      const d = JSON.parse(t);
      if (d && d.months && Array.isArray(d.ledger)) {
        state = normalize(d);
        save();
        render();
      } else {
        alert('Not a Formial finance export.');
      }
    }).catch(() => alert('Could not read that file.'));
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

  // Legend hover interaction
  if ($('legend')) {
    $('legend').addEventListener('pointerover', (e) => {
      const legEl = e.target.closest('[data-legend]');
      if (!legEl) return;
      const legName = legEl.dataset.legend;
      $('overall').classList.add('has-legend-hover');
      $('overall').querySelectorAll('.seg-rect').forEach((r) => {
        r.classList.toggle('seg-dimmed', r.dataset.name !== legName);
      });
    });

    $('legend').addEventListener('pointerout', (e) => {
      if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
      $('overall').classList.remove('has-legend-hover');
      $('overall').querySelectorAll('.seg-rect').forEach((r) => r.classList.remove('seg-dimmed'));
    });
  }

  window.addEventListener('scroll', hideTooltip, { passive: true });

  // Init
  (async function init() {
    setupChartTooltips($('overall'));
    setupChartTooltips($('rxChart'));
    setTab(activeTab);
    render();
    if (!online) return;
    try {
      const res = await api('/api/data');
      if (!res.ok) return;
      const d = await res.json();
      const serverHas = d && d.months && (Object.keys(d.months).length || (d.ledger || []).length);
      if (serverHas) {
        state = normalize(d);
        cache();
      } else if (Object.keys(state.months).length || state.ledger.length) {
        save();
      }
      render();
    } catch (e) {}
  })();
})();
