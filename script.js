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
  const inrFmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    if (s.months['2026-09'] && !s.months['2026-09'].rxReportCustom) {
      s.months['2026-09'].rxReportCustom = {
        count20: 472,
        count50: 1,
        countFoam: 8,
        countOld: 0,
        packCost: 101910.00,
        apiCost: 15382.33,
        preparedBy: 'Pharmacy Operations',
        approvedBy: 'Saad',
        notes: ''
      };
    }
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
    let out = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"><line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="#BFE6FF"/>`;
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
    chartEl.innerHTML = data.some(({ c }) => c.has) ? barSvg(Math.max(chartEl.clientWidth || 640, data.length * 90), 260, cols, inr) : '<div class="empty">Enter pump counts to see the monthly cost trend.</div>';
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

  // Month note (shown only when one was entered)
  function renderNote() {
    const r = rec(cur), noteEl = $('noteDisplay'), card = $('noteCard');
    if (!noteEl || !card) return;
    card.hidden = !r.note;
    noteEl.innerHTML = r.note ? `<b>Note for ${label(cur, true)}:</b> ${esc(r.note)}` : '';
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

  // ---- Reports & PDF Module -----------------------------------------------
  let currentModalReport = 'consolidated';

  function getMonthMeta(m) {
    const [yStr, moStr] = m.split('-');
    const y = parseInt(yStr, 10);
    const mo = parseInt(moStr, 10);
    const lastDay = new Date(y, mo, 0).getDate();
    const dObj = new Date(y, mo - 1, 1);
    const monthName = dObj.toLocaleString('en-IN', { month: 'long' });
    const shortMonthName = dObj.toLocaleString('en-IN', { month: 'short' });
    const startIso = `${m}-01`;
    const endIso = `${m}-${String(lastDay).padStart(2, '0')}`;
    return {
      year: y,
      monthNum: mo,
      monthName,
      shortMonthName,
      lastDay,
      startIso,
      endIso,
      periodLabel: `${monthName} ${y}`,
      periodShort: monthName,
      dateRangeLabel: `${startIso} to ${endIso}`,
      generatedLabel: `Generated ${lastDay} ${shortMonthName} ${y}`
    };
  }

  function getRxReportData(m) {
    const r = rec(m);
    const pu = r.pumps || {};
    const u = state.unitCosts || {};
    const isPreOrAug = m <= '2026-08';
    const custom = r.rxReportCustom;

    if (custom) {
      const count20 = num(custom.count20);
      const count50 = num(custom.count50);
      const countFoam = num(custom.countFoam);
      const countOld = isPreOrAug ? num(custom.countOld) : 0;
      const totalRx = count20 + count50 + countFoam + countOld;
      const packCost = num(custom.packCost);
      const apiCost = num(custom.apiCost);
      const totalCost = packCost + apiCost;
      return {
        isCustom: true,
        count20,
        count50,
        countFoam,
        countOld,
        totalRx,
        packCost,
        apiCost,
        totalCost,
        preparedBy: custom.preparedBy || 'Pharmacy Operations',
        approvedBy: custom.approvedBy || 'Saad',
        notes: custom.notes !== undefined ? custom.notes : (r.note || '')
      };
    }

    const countOld = isPreOrAug ? num(pu.old) : 0;
    const count20 = num(pu.new) + num(pu.refill);
    const count50 = num(pu.lotion);
    const countFoam = num(pu.foam);
    const totalRx = countOld + count20 + count50 + countFoam;

    let packCost = (num(pu.new) * num(u.new?.pack)) +
                   (num(pu.refill) * num(u.refill?.pack)) +
                   (num(pu.lotion) * num(u.lotion?.pack)) +
                   (num(pu.foam) * num(u.foam?.pack));
    if (isPreOrAug && pu.old) {
      packCost += num(pu.old) * num(u.old?.pack);
    }

    let apiCost = (num(pu.new) * num(u.new?.api)) +
                  (num(pu.refill) * num(u.refill?.api)) +
                  (num(pu.lotion) * num(u.lotion?.api)) +
                  (num(pu.foam) * num(u.foam?.api));
    if (isPreOrAug && pu.old) {
      apiCost += num(pu.old) * num(u.old?.api);
    }

    if (isPreOrAug && !countOld && (r.oldPackCost || r.oldIngCost)) {
      packCost += num(r.oldPackCost);
      apiCost += num(r.oldIngCost);
    }

    let totalCost = packCost + apiCost;
    if (r.override !== undefined && r.override !== null && r.override !== '') {
      totalCost = num(r.override);
    }

    return {
      isCustom: false,
      count20,
      count50,
      countFoam,
      countOld,
      totalRx,
      packCost,
      apiCost,
      totalCost,
      preparedBy: 'Pharmacy Operations',
      approvedBy: 'Saad',
      notes: r.note || ''
    };
  }

  function getManualReportData(m) {
    const items = state.ledger.filter((e) => e.date && e.date.slice(0, 7) === m).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const rdItems = items.filter((e) => e.cat === 'R&D');
    const mktItems = items.filter((e) => e.cat === 'Marketing');
    const otherItems = items.filter((e) => e.cat === 'Others');
    const rdTotal = rdItems.reduce((s, e) => s + num(e.amt), 0);
    const mktTotal = mktItems.reduce((s, e) => s + num(e.amt), 0);
    const otherTotal = otherItems.reduce((s, e) => s + num(e.amt), 0);
    const totalManual = rdTotal + mktTotal + otherTotal;
    return { items, rdItems, mktItems, otherItems, rdTotal, mktTotal, otherTotal, totalManual };
  }

  function renderReportsHubSummary() {
    const manData = getManualReportData(cur);
    if ($('cardRdInfo')) {
      $('cardRdInfo').textContent = manData.rdItems.length
        ? `${manData.rdItems.length} entries · Total ${inrFmt(manData.rdTotal)}`
        : `No R&D expenses recorded (${inrFmt(0)})`;
    }
    if ($('cardMktInfo')) {
      $('cardMktInfo').textContent = manData.mktItems.length
        ? `${manData.mktItems.length} entries · Total ${inrFmt(manData.mktTotal)}`
        : `No marketing expenses recorded (${inrFmt(0)})`;
    }
    if ($('cardOtherInfo')) {
      $('cardOtherInfo').textContent = manData.otherItems.length
        ? `${manData.otherItems.length} entries · Total ${inrFmt(manData.otherTotal)}`
        : `No miscellaneous expenses recorded (${inrFmt(0)})`;
    }
    if ($('rdSelCount')) $('rdSelCount').textContent = `${manData.rdItems.length} items (${inrFmt(manData.rdTotal)})`;
    if ($('mktSelCount')) $('mktSelCount').textContent = `${manData.mktItems.length} items (${inrFmt(manData.mktTotal)})`;
    if ($('otherSelCount')) $('otherSelCount').textContent = `${manData.otherItems.length} items (${inrFmt(manData.otherTotal)})`;
  }

  function generateReportHtml(reportType, m, liveRx) {
    const meta = getMonthMeta(m);
    const rxData = liveRx || getRxReportData(m);
    const manData = getManualReportData(m);
    const grandTotal = rxData.totalCost + manData.totalManual;
    const isPreOrAug = m <= '2026-08';

    const pct = (cnt, tot) => (tot > 0 ? ((cnt / tot) * 100).toFixed(1) : '0.0') + '%';
    const volumeRows = [];
    if (rxData.count20 > 0 || rxData.totalRx === 0) {
      volumeRows.push(`<tr><td>20g Customized Cream</td><td class="num">${rxData.count20.toLocaleString('en-IN')}</td><td class="num">${pct(rxData.count20, rxData.totalRx)}</td></tr>`);
    }
    if (rxData.count50 > 0 || rxData.totalRx === 0) {
      volumeRows.push(`<tr><td>50g Standard Cream</td><td class="num">${rxData.count50.toLocaleString('en-IN')}</td><td class="num">${pct(rxData.count50, rxData.totalRx)}</td></tr>`);
    }
    if (rxData.countFoam > 0 || rxData.totalRx === 0) {
      volumeRows.push(`<tr><td>Foam Solution (50ml)</td><td class="num">${rxData.countFoam.toLocaleString('en-IN')}</td><td class="num">${pct(rxData.countFoam, rxData.totalRx)}</td></tr>`);
    }
    if (isPreOrAug && rxData.countOld > 0) {
      volumeRows.push(`<tr><td>Old Pumps (Dispensed)</td><td class="num">${rxData.countOld.toLocaleString('en-IN')}</td><td class="num">${pct(rxData.countOld, rxData.totalRx)}</td></tr>`);
    }

    if (reportType === 'consolidated') {
      const rxShare = grandTotal ? ((rxData.totalCost / grandTotal) * 100).toFixed(1) : '100.0';
      let manualRows = '';
      if (manData.rdTotal > 0) {
        const sh = grandTotal ? ((manData.rdTotal / grandTotal) * 100).toFixed(1) : '0.0';
        manualRows += `<tr><td>Research &amp; Development (R&amp;D)</td><td class="num">&mdash;</td><td class="num">&mdash;</td><td class="num">${inrFmt(manData.rdTotal)}</td><td class="num">${sh}%</td></tr>`;
      }
      if (manData.mktTotal > 0) {
        const sh = grandTotal ? ((manData.mktTotal / grandTotal) * 100).toFixed(1) : '0.0';
        manualRows += `<tr><td>Marketing &amp; Growth</td><td class="num">&mdash;</td><td class="num">&mdash;</td><td class="num">${inrFmt(manData.mktTotal)}</td><td class="num">${sh}%</td></tr>`;
      }
      if (manData.otherTotal > 0) {
        const sh = grandTotal ? ((manData.otherTotal / grandTotal) * 100).toFixed(1) : '0.0';
        manualRows += `<tr><td>Operational &amp; Other Expenses</td><td class="num">&mdash;</td><td class="num">&mdash;</td><td class="num">${inrFmt(manData.otherTotal)}</td><td class="num">${sh}%</td></tr>`;
      }

      let manualLedgerSec = '';
      if (manData.items.length > 0) {
        manualLedgerSec = `
          <div class="rep-section">
            <h3 class="rep-section-title">3. Manual Usage Ledger Summary (R&amp;D, Marketing, Others)</h3>
            <table class="rep-table">
              <thead>
                <tr>
                  <th style="text-align:left;">DATE</th>
                  <th style="text-align:left;">COST CENTER</th>
                  <th style="text-align:left;">DESCRIPTION / PARTICULARS</th>
                  <th class="num">TOTAL SPEND</th>
                </tr>
              </thead>
              <tbody>
                ${manData.items.map((e) => `<tr><td>${e.date ? e.date.slice(8) + '/' + e.date.slice(5, 7) + '/' + e.date.slice(0, 4) : '&mdash;'}</td><td>${esc(e.cat)}</td><td>${esc(e.desc)}</td><td class="num">${inrFmt(e.amt)}</td></tr>`).join('')}
              </tbody>
              <tfoot>
                <tr class="rep-tot-row">
                  <td colspan="3">TOTAL MANUAL USAGE EXPENDITURE</td>
                  <td class="num">${inrFmt(manData.totalManual)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        `;
      }

      return `
        <div class="rep-header">
          <div class="rep-brand-row">
            <div class="rep-brand-name">Formial Labs Pharmacy</div>
            <div class="rep-date">${meta.generatedLabel}</div>
          </div>
          <div class="rep-brand-rule"></div>
          <div class="rep-title">Accountant &amp; Executive Cost Summary</div>
          <div class="rep-subtitle">Period: ${meta.periodShort}</div>
        </div>

        <div class="rep-kpi-box">
          <div class="rep-kpi-col">
            <div class="rep-kpi-label">TOTAL EXPENDITURE / COGS</div>
            <div class="rep-kpi-val">${inrFmt(grandTotal)}</div>
          </div>
          <div class="rep-kpi-col">
            <div class="rep-kpi-label">TOTAL PRESCRIPTIONS</div>
            <div class="rep-kpi-val">${rxData.totalRx.toLocaleString('en-IN')}</div>
          </div>
        </div>

        <div class="rep-section">
          <h3 class="rep-section-title">1. Master Expenditure Breakdown</h3>
          <table class="rep-table">
            <thead>
              <tr>
                <th style="text-align:left;">COST CENTER / DEPARTMENT</th>
                <th class="num">INGREDIENTS / APIS</th>
                <th class="num">PACKAGING COST</th>
                <th class="num">TOTAL SPEND</th>
                <th class="num">SHARE</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Pharmacy Prescriptions</td>
                <td class="num">${inrFmt(rxData.apiCost)}</td>
                <td class="num">${inrFmt(rxData.packCost)}</td>
                <td class="num">${inrFmt(rxData.totalCost)}</td>
                <td class="num">${rxShare}%</td>
              </tr>
              ${manualRows}
            </tbody>
            <tfoot>
              <tr class="rep-tot-row">
                <td>TOTAL EXPENDITURE</td>
                <td class="num">${inrFmt(rxData.apiCost)}</td>
                <td class="num">${inrFmt(rxData.packCost)}</td>
                <td class="num">${inrFmt(grandTotal)}</td>
                <td class="num">100.0%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="rep-section">
          <h3 class="rep-section-title">2. Prescription Volume &amp; Operations Breakdown</h3>
          <table class="rep-table">
            <thead>
              <tr>
                <th style="text-align:left;">FORMULATION / SIZE</th>
                <th class="num">PRESCRIPTIONS</th>
                <th class="num">VOLUME SHARE</th>
              </tr>
            </thead>
            <tbody>
              ${volumeRows.join('')}
            </tbody>
            <tfoot>
              <tr class="rep-tot-row">
                <td>TOTAL PRESCRIPTIONS</td>
                <td class="num">${rxData.totalRx.toLocaleString('en-IN')}</td>
                <td class="num">100.0%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        ${manualLedgerSec}

        <div class="rep-signatures">
          <div>Prepared by: ${rxData.preparedBy}</div>
          <div>Verified &amp; Approved by: ${rxData.approvedBy}</div>
        </div>
      `;
    }

    if (reportType === 'rx') {
      const apiShare = rxData.totalCost ? ((rxData.apiCost / rxData.totalCost) * 100).toFixed(1) : '0.0';
      const packShare = rxData.totalCost ? ((rxData.packCost / rxData.totalCost) * 100).toFixed(1) : '0.0';

      return `
        <div class="rep-header">
          <div class="rep-brand-row">
            <div class="rep-brand-name">Formial Labs Pharmacy</div>
            <div class="rep-date">${meta.generatedLabel}</div>
          </div>
          <div class="rep-brand-rule"></div>
          <div class="rep-title">Prescription &amp; Compounding Operations Report</div>
          <div class="rep-subtitle">Period: ${meta.periodShort} &middot; Cost Center: Pharmacy Prescriptions</div>
        </div>

        <div class="rep-kpi-box">
          <div class="rep-kpi-col">
            <div class="rep-kpi-label">TOTAL RX EXPENDITURE</div>
            <div class="rep-kpi-val">${inrFmt(rxData.totalCost)}</div>
          </div>
          <div class="rep-kpi-col">
            <div class="rep-kpi-label">TOTAL PRESCRIPTIONS</div>
            <div class="rep-kpi-val">${rxData.totalRx.toLocaleString('en-IN')}</div>
          </div>
        </div>

        <div class="rep-section">
          <h3 class="rep-section-title">1. Prescription Volume &amp; Dispensing Breakdown</h3>
          <table class="rep-table">
            <thead>
              <tr>
                <th style="text-align:left;">FORMULATION / SIZE</th>
                <th class="num">PRESCRIPTIONS</th>
                <th class="num">VOLUME SHARE</th>
              </tr>
            </thead>
            <tbody>
              ${volumeRows.join('')}
            </tbody>
            <tfoot>
              <tr class="rep-tot-row">
                <td>TOTAL PRESCRIPTIONS</td>
                <td class="num">${rxData.totalRx.toLocaleString('en-IN')}</td>
                <td class="num">100.0%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="rep-section">
          <h3 class="rep-section-title">2. Compounding Expenditure Breakdown</h3>
          <table class="rep-table">
            <thead>
              <tr>
                <th style="text-align:left;">EXPENDITURE COMPONENT</th>
                <th class="num">TOTAL SPEND</th>
                <th class="num">COST SHARE</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ingredients &amp; Active Pharmaceutical Ingredients (APIs)</td>
                <td class="num">${inrFmt(rxData.apiCost)}</td>
                <td class="num">${apiShare}%</td>
              </tr>
              <tr>
                <td>Primary &amp; Secondary Packaging Cost</td>
                <td class="num">${inrFmt(rxData.packCost)}</td>
                <td class="num">${packShare}%</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="rep-tot-row">
                <td>TOTAL COMPOUNDING EXPENDITURE</td>
                <td class="num">${inrFmt(rxData.totalCost)}</td>
                <td class="num">100.0%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        ${rxData.notes ? `
          <div class="rep-section">
            <h3 class="rep-section-title">3. Operations &amp; Batch Notes</h3>
            <p style="font-size:12px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;padding:10px 12px;border-radius:4px;margin:0;line-height:1.5;">${esc(rxData.notes)}</p>
          </div>
        ` : ''}

        <div class="rep-signatures">
          <div>Prepared by: ${rxData.preparedBy}</div>
          <div>Verified &amp; Approved by: ${rxData.approvedBy}</div>
        </div>
      `;
    }

    if (reportType === 'rd') {
      return `
        <div class="rep-header">
          <div class="rep-brand-row">
            <div class="rep-brand-name">Formial Labs Pharmacy</div>
            <div class="rep-date">${meta.generatedLabel}</div>
          </div>
          <div class="rep-brand-rule"></div>
          <div class="rep-title">Research &amp; Development (R&amp;D) Cost Summary</div>
          <div class="rep-subtitle">Period: ${meta.periodShort} &middot; Cost Center: Research &amp; Development</div>
        </div>

        <div class="rep-kpi-box">
          <div class="rep-kpi-col">
            <div class="rep-kpi-label">TOTAL R&amp;D EXPENDITURE</div>
            <div class="rep-kpi-val">${inrFmt(manData.rdTotal)}</div>
          </div>
          <div class="rep-kpi-col">
            <div class="rep-kpi-label">TOTAL ENTRIES / TRANSACTIONS</div>
            <div class="rep-kpi-val">${manData.rdItems.length}</div>
          </div>
        </div>

        <div class="rep-section">
          <h3 class="rep-section-title">1. Itemized R&amp;D Expense Ledger</h3>
          <table class="rep-table">
            <thead>
              <tr>
                <th style="text-align:left;">DATE</th>
                <th style="text-align:left;">COST CENTER</th>
                <th style="text-align:left;">DESCRIPTION / PARTICULARS</th>
                <th class="num">TOTAL SPEND</th>
              </tr>
            </thead>
            <tbody>
              ${manData.rdItems.length ? manData.rdItems.map((e) => `
                <tr>
                  <td>${e.date ? e.date.slice(8) + '/' + e.date.slice(5, 7) + '/' + e.date.slice(0, 4) : '&mdash;'}</td>
                  <td>R&amp;D</td>
                  <td>${esc(e.desc)}</td>
                  <td class="num">${inrFmt(e.amt)}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="4" style="text-align:center;color:#64748b;padding:16px;">No R&amp;D expenses recorded for this billing cycle (${inrFmt(0)}).</td>
                </tr>
              `}
            </tbody>
            <tfoot>
              <tr class="rep-tot-row">
                <td colspan="3">TOTAL R&amp;D SPEND</td>
                <td class="num">${inrFmt(manData.rdTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="rep-signatures">
          <div>Prepared by: Accounts &amp; Operations</div>
          <div>Verified &amp; Approved by: Saad</div>
        </div>
      `;
    }

    if (reportType === 'mkt') {
      return `
        <div class="rep-header">
          <div class="rep-brand-row">
            <div class="rep-brand-name">Formial Labs Pharmacy</div>
            <div class="rep-date">${meta.generatedLabel}</div>
          </div>
          <div class="rep-brand-rule"></div>
          <div class="rep-title">Marketing &amp; Growth Cost Summary</div>
          <div class="rep-subtitle">Period: ${meta.periodShort} &middot; Cost Center: Marketing</div>
        </div>

        <div class="rep-kpi-box">
          <div class="rep-kpi-col">
            <div class="rep-kpi-label">TOTAL MARKETING EXPENDITURE</div>
            <div class="rep-kpi-val">${inrFmt(manData.mktTotal)}</div>
          </div>
          <div class="rep-kpi-col">
            <div class="rep-kpi-label">TOTAL ENTRIES / TRANSACTIONS</div>
            <div class="rep-kpi-val">${manData.mktItems.length}</div>
          </div>
        </div>

        <div class="rep-section">
          <h3 class="rep-section-title">1. Itemized Marketing Expense Ledger</h3>
          <table class="rep-table">
            <thead>
              <tr>
                <th style="text-align:left;">DATE</th>
                <th style="text-align:left;">COST CENTER</th>
                <th style="text-align:left;">DESCRIPTION / PARTICULARS</th>
                <th class="num">TOTAL SPEND</th>
              </tr>
            </thead>
            <tbody>
              ${manData.mktItems.length ? manData.mktItems.map((e) => `
                <tr>
                  <td>${e.date ? e.date.slice(8) + '/' + e.date.slice(5, 7) + '/' + e.date.slice(0, 4) : '&mdash;'}</td>
                  <td>Marketing</td>
                  <td>${esc(e.desc)}</td>
                  <td class="num">${inrFmt(e.amt)}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="4" style="text-align:center;color:#64748b;padding:16px;">No marketing expenses recorded for this billing cycle (${inrFmt(0)}).</td>
                </tr>
              `}
            </tbody>
            <tfoot>
              <tr class="rep-tot-row">
                <td colspan="3">TOTAL MARKETING SPEND</td>
                <td class="num">${inrFmt(manData.mktTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="rep-signatures">
          <div>Prepared by: Accounts &amp; Operations</div>
          <div>Verified &amp; Approved by: Saad</div>
        </div>
      `;
    }

    if (reportType === 'other') {
      return `
        <div class="rep-header">
          <div class="rep-brand-row">
            <div class="rep-brand-name">Formial Labs Pharmacy</div>
            <div class="rep-date">${meta.generatedLabel}</div>
          </div>
          <div class="rep-brand-rule"></div>
          <div class="rep-title">Operational &amp; Miscellaneous Cost Summary (Others)</div>
          <div class="rep-subtitle">Period: ${meta.periodShort} &middot; Cost Center: Operational &amp; Others</div>
        </div>

        <div class="rep-kpi-box">
          <div class="rep-kpi-col">
            <div class="rep-kpi-label">TOTAL OTHER EXPENDITURE</div>
            <div class="rep-kpi-val">${inrFmt(manData.otherTotal)}</div>
          </div>
          <div class="rep-kpi-col">
            <div class="rep-kpi-label">TOTAL ENTRIES / TRANSACTIONS</div>
            <div class="rep-kpi-val">${manData.otherItems.length}</div>
          </div>
        </div>

        <div class="rep-section">
          <h3 class="rep-section-title">1. Itemized Operational Expense Ledger</h3>
          <table class="rep-table">
            <thead>
              <tr>
                <th style="text-align:left;">DATE</th>
                <th style="text-align:left;">COST CENTER</th>
                <th style="text-align:left;">DESCRIPTION / PARTICULARS</th>
                <th class="num">TOTAL SPEND</th>
              </tr>
            </thead>
            <tbody>
              ${manData.otherItems.length ? manData.otherItems.map((e) => `
                <tr>
                  <td>${e.date ? e.date.slice(8) + '/' + e.date.slice(5, 7) + '/' + e.date.slice(0, 4) : '&mdash;'}</td>
                  <td>Others</td>
                  <td>${esc(e.desc)}</td>
                  <td class="num">${inrFmt(e.amt)}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="4" style="text-align:center;color:#64748b;padding:16px;">No miscellaneous expenses recorded for this billing cycle (${inrFmt(0)}).</td>
                </tr>
              `}
            </tbody>
            <tfoot>
              <tr class="rep-tot-row">
                <td colspan="3">TOTAL OTHER SPEND</td>
                <td class="num">${inrFmt(manData.otherTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="rep-signatures">
          <div>Prepared by: Accounts &amp; Operations</div>
          <div>Verified &amp; Approved by: Saad</div>
        </div>
      `;
    }

    return '';
  }

  async function downloadReportAsPdf(reportType, monthStr) {
    const meta = getMonthMeta(monthStr);
    let filename = '';
    if (reportType === 'consolidated') {
      filename = `Formial_Accounting_Summary_${meta.startIso}_to_${meta.endIso}.pdf`;
    } else if (reportType === 'rx') {
      filename = `Formial_Rx_Report_${monthStr}.pdf`;
    } else if (reportType === 'rd') {
      filename = `Formial_RD_Report_${monthStr}.pdf`;
    } else if (reportType === 'mkt') {
      filename = `Formial_Marketing_Report_${monthStr}.pdf`;
    } else if (reportType === 'other') {
      filename = `Formial_Other_Report_${monthStr}.pdf`;
    }

    setModalStatusMsg(`Generating ${filename}...`);

    const liveRx = (reportType === 'rx' || rec(monthStr).rxReportCustom) ? getLiveRxEditValues() : null;
    const htmlContent = generateReportHtml(reportType, monthStr, liveRx);

    const container = document.createElement('div');
    container.className = 'report-sheet-pdf-export';
    container.innerHTML = htmlContent;
    document.body.appendChild(container);

    const opt = {
      margin: [10, 10, 10, 10],
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        letterRendering: true,
        backgroundColor: '#ffffff'
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait'
      }
    };

    try {
      if (window.html2pdf) {
        await window.html2pdf().set(opt).from(container).save();
        setModalStatusMsg(`Downloaded ${filename} successfully!`);
      } else {
        printReport(reportType, monthStr);
        setModalStatusMsg('Opened print dialog (Save as PDF).');
      }
    } catch (err) {
      console.error('PDF generation error:', err);
      printReport(reportType, monthStr);
      setModalStatusMsg('Fallback: opened browser print dialog.');
    } finally {
      container.remove();
      setTimeout(() => setModalStatusMsg(''), 4000);
    }
  }

  function printReport(reportType, monthStr) {
    const liveRx = (reportType === 'rx' || rec(monthStr).rxReportCustom) ? getLiveRxEditValues() : null;
    const htmlContent = generateReportHtml(reportType, monthStr, liveRx);
    const printArea = $('reportPrintArea');
    if (!printArea) return;
    printArea.innerHTML = `<div class="report-sheet">${htmlContent}</div>`;
    printArea.hidden = false;
    window.print();
    setTimeout(() => {
      printArea.hidden = true;
      printArea.innerHTML = '';
    }, 1000);
  }

  async function downloadAllReports(monthStr) {
    const types = ['consolidated', 'rx', 'rd', 'mkt', 'other'];
    setModalStatusMsg('Starting download of all 5 reports...');
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      setModalStatusMsg(`Downloading [${i + 1}/5] ${t.toUpperCase()} report...`);
      await downloadReportAsPdf(t, monthStr);
      await new Promise((r) => setTimeout(r, 900));
    }
    setModalStatusMsg('All 5 reports downloaded successfully!');
    setTimeout(() => setModalStatusMsg(''), 4000);
  }

  function setModalStatusMsg(msg) {
    const el = $('reportsStatusMsg');
    if (el) el.textContent = msg || '';
  }

  function openReportsModal(reportType) {
    currentModalReport = reportType || 'consolidated';
    const modal = $('reportsModal');
    if (!modal) return;
    modal.hidden = false;
    $('modalPeriodLabel').textContent = label(cur, true);

    document.querySelectorAll('.report-sel-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.report === currentModalReport);
    });

    populateRxEditForm();

    const rxEditPanel = $('rxEditPanel');
    if (rxEditPanel) {
      rxEditPanel.style.display = currentModalReport === 'rx' ? 'flex' : 'none';
    }

    updateDownloadBtnLabel();
    renderPreviewSheet();
  }

  function closeReportsModal() {
    const modal = $('reportsModal');
    if (modal) modal.hidden = true;
    setModalStatusMsg('');
  }

  function updateDownloadBtnLabel() {
    const lbl = $('btnDownloadLabel');
    if (!lbl) return;
    const map = {
      consolidated: 'Download Consolidated PDF',
      rx: 'Download Rx Report PDF',
      rd: 'Download R&D PDF',
      mkt: 'Download Marketing PDF',
      other: 'Download Other PDF'
    };
    lbl.textContent = map[currentModalReport] || 'Download Selected PDF';
  }

  function populateRxEditForm() {
    const rxData = getRxReportData(cur);
    const isPreOrAug = cur <= '2026-08';
    if ($('rxEdit20')) $('rxEdit20').value = rxData.count20;
    if ($('rxEdit50')) $('rxEdit50').value = rxData.count50;
    if ($('rxEditFoam')) $('rxEditFoam').value = rxData.countFoam;
    if ($('rxEditOld')) $('rxEditOld').value = rxData.countOld;
    if ($('rxEditOldFld')) $('rxEditOldFld').style.display = isPreOrAug ? 'flex' : 'none';
    if ($('rxEditPack')) $('rxEditPack').value = rxData.packCost;
    if ($('rxEditApi')) $('rxEditApi').value = rxData.apiCost;
    if ($('rxEditPrep')) $('rxEditPrep').value = rxData.preparedBy;
    if ($('rxEditAppr')) $('rxEditAppr').value = rxData.approvedBy;
    if ($('rxEditNotes')) $('rxEditNotes').value = rxData.notes || '';
  }

  function getLiveRxEditValues() {
    const isPreOrAug = cur <= '2026-08';
    const c20 = num($('rxEdit20')?.value);
    const c50 = num($('rxEdit50')?.value);
    const cFoam = num($('rxEditFoam')?.value);
    const cOld = isPreOrAug ? num($('rxEditOld')?.value) : 0;
    const pCost = num($('rxEditPack')?.value);
    const aCost = num($('rxEditApi')?.value);
    return {
      isCustom: true,
      count20: c20,
      count50: c50,
      countFoam: cFoam,
      countOld: cOld,
      totalRx: c20 + c50 + cFoam + cOld,
      packCost: pCost,
      apiCost: aCost,
      totalCost: pCost + aCost,
      preparedBy: $('rxEditPrep')?.value || 'Pharmacy Operations',
      approvedBy: $('rxEditAppr')?.value || 'Saad',
      notes: $('rxEditNotes')?.value || ''
    };
  }

  function renderPreviewSheet() {
    const sheet = $('reportPreviewSheet');
    if (!sheet) return;
    const liveRx = (currentModalReport === 'rx' || rec(cur).rxReportCustom) ? getLiveRxEditValues() : null;
    sheet.innerHTML = generateReportHtml(currentModalReport, cur, liveRx);
  }

  function render(skipForm) {
    $('month').value = cur;
    const moText = label(cur, true);
    if ($('statsMonthLabel')) $('statsMonthLabel').textContent = moText;
    if ($('figuresMonthLabel')) $('figuresMonthLabel').textContent = moText;
    if ($('figSub')) $('figSub').textContent = moText;
    if ($('reportsSub')) $('reportsSub').textContent = moText;

    const c = calc(cur), p = calc(shift(cur, -1));
    renderKpis(c, p);
    renderRx(c);
    renderCost(c);
    renderOverall();
    renderNote();
    renderLedger();
    renderReportsHubSummary();
    if (!skipForm) {
      renderForm();
      renderUnits();
    }
    $('lDate').value = $('lDate').value && $('lDate').value.slice(0, 7) === cur ? $('lDate').value : cur + '-01';

    if ($('reportsModal') && !$('reportsModal').hidden) {
      $('modalPeriodLabel').textContent = moText;
      populateRxEditForm();
      renderPreviewSheet();
    }
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

  // ---- Reports UI & Modal Events ------------------------------------------
  if ($('hubDownloadAll')) $('hubDownloadAll').onclick = () => downloadAllReports(cur);

  // Card click delegation in panelMonthlyStats
  document.querySelectorAll('.reports-cards-grid .report-box').forEach((card) => {
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const act = btn.dataset.action;
      const rtype = btn.dataset.rtype || card.dataset.rtype;
      if (act === 'download') {
        downloadReportAsPdf(rtype, cur);
      } else if (act === 'preview') {
        openReportsModal(rtype);
      } else if (act === 'edit-rx') {
        openReportsModal('rx');
      }
    });
  });

  // Modal report switcher
  if ($('reportSelectorList')) {
    $('reportSelectorList').addEventListener('click', (e) => {
      const btn = e.target.closest('.report-sel-btn');
      if (!btn) return;
      document.querySelectorAll('.report-sel-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentModalReport = btn.dataset.report;
      const rxPanel = $('rxEditPanel');
      if (rxPanel) rxPanel.style.display = currentModalReport === 'rx' ? 'flex' : 'none';
      updateDownloadBtnLabel();
      renderPreviewSheet();
    });
  }

  // Modal close & print & download actions
  if ($('closeReportsModal')) $('closeReportsModal').onclick = closeReportsModal;
  if ($('reportsModal')) {
    $('reportsModal').onclick = (e) => {
      if (e.target === $('reportsModal')) closeReportsModal();
    };
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('reportsModal') && !$('reportsModal').hidden) {
      closeReportsModal();
    }
  });

  if ($('btnDownloadCurrentPdf')) {
    $('btnDownloadCurrentPdf').onclick = () => downloadReportAsPdf(currentModalReport, cur);
  }
  if ($('btnPrintCurrentPdf')) {
    $('btnPrintCurrentPdf').onclick = () => printReport(currentModalReport, cur);
  }
  if ($('btnDownloadAllPdf')) {
    $('btnDownloadAllPdf').onclick = () => downloadAllReports(cur);
  }

  // Live input events on Rx edit form
  ['rxEdit20', 'rxEdit50', 'rxEditFoam', 'rxEditOld', 'rxEditPack', 'rxEditApi', 'rxEditPrep', 'rxEditAppr', 'rxEditNotes'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', () => { renderPreviewSheet(); });
  });

  if ($('rxSaveCustom')) {
    $('rxSaveCustom').onclick = () => {
      const vals = getLiveRxEditValues();
      state.months[cur] = state.months[cur] || {};
      state.months[cur].rxReportCustom = vals;
      save();
      render(true);
      renderPreviewSheet();
      setModalStatusMsg('Rx figures saved! Preview and reports updated.');
      setTimeout(() => setModalStatusMsg(''), 4000);
    };
  }

  if ($('rxResetCustom')) {
    $('rxResetCustom').onclick = () => {
      if (state.months[cur] && state.months[cur].rxReportCustom) {
        delete state.months[cur].rxReportCustom;
        save();
        render(true);
      }
      populateRxEditForm();
      renderPreviewSheet();
      setModalStatusMsg('Reset to calculated defaults.');
      setTimeout(() => setModalStatusMsg(''), 4000);
    };
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
