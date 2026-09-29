// Investing Tracker: browser app. Data lives in localStorage on this device only.
(function () {
  'use strict';
  const C = window.Calc;
  const KEY = 'investing-tracker-v1';
  const DAILY_LIMIT = 25;
  const QUOTE_TTL = 30 * 60 * 1000;      // re-fetch a quote after 30 minutes
  const FX_TTL = 6 * 60 * 60 * 1000;     // USD/CAD every 6 hours
  const SERIES_TTL = 12 * 60 * 60 * 1000; // daily history twice a day
  const AUTO_REFRESH_AFTER = 4 * 60 * 60 * 1000;
  const COLORS = ['#6cc4ff', '#a894ff', '#5fd6a0', '#f5c565', '#ff8f84', '#7fa3c7', '#4fb8b8', '#d58ad2', '#c5d86d', '#9aa9ff'];

  /* ---------- demo data (fictional prices) ---------- */
  function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  function demoSeries(end, seed, drift) {
    const r = seeded(seed), pts = []; let p = end / (1 + drift);
    const start = new Date(); start.setDate(start.getDate() - 145);
    for (let d = new Date(start); pts.length < 100; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      p = p * (1 + (r() - 0.48) * 0.028);
      pts.push([d.toISOString().slice(0, 10), p]);
    }
    const k = end / pts[pts.length - 1][1];
    return pts.map(([d, v]) => [d, Math.round(v * k * 100) / 100]);
  }
  const DEMO = (() => {
    const list = [
      ['SHOP.TRT', 12, 98.40, 'CAD', 118.25, 0.12, 11],
      ['RY.TRT', 15, 142.10, 'CAD', 171.60, 0.08, 23],
      ['XIU.TRT', 40, 33.20, 'CAD', 38.45, 0.06, 37],
      ['AAPL', 6, 180.00, 'USD', 226.30, 0.05, 41],
      ['NVDA', 10, 95.00, 'USD', 131.80, 0.18, 53],
    ];
    const holdings = [], quotes = {}, series = {};
    for (const [symbol, shares, avgCost, costCurrency, price, drift, seed] of list) {
      holdings.push({ symbol, shares, avgCost, costCurrency });
      const s = demoSeries(price, seed, drift);
      series[symbol] = { points: s, fetchedAt: Date.now() };
      const prev = s[s.length - 2][1];
      quotes[symbol] = { price, prevClose: prev, change: price - prev, changePct: (price - prev) / prev * 100, high: price * 1.01, low: price * 0.985, volume: 0, latestDay: s[s.length - 1][0], fetchedAt: Date.now(), demo: true };
    }
    for (const [symbol, price, seed] of [['SPY', 571.20, 61], ['QQQ', 489.55, 67]]) {
      const s = demoSeries(price, seed, 0.07); const prev = s[s.length - 2][1];
      quotes[symbol] = { price, prevClose: prev, change: price - prev, changePct: (price - prev) / prev * 100, fetchedAt: Date.now(), demo: true };
      series[symbol] = { points: s, fetchedAt: Date.now() };
    }
    return { holdings, quotes, series, fx: { rate: 1.37, fetchedAt: Date.now(), demo: true } };
  })();

  /* ---------- state ---------- */
  function blank() { return { apiKey: '', watch: ['XIU.TRT', 'SPY', 'QQQ'], holdings: [], quotes: {}, series: {}, fx: null, names: {}, usage: { day: '', count: 0 }, lastRefresh: 0 }; }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === 'object') return Object.assign(blank(), s); } catch (e) { /* ignore */ }
    return blank();
  }
  let S = load();
  const live = () => !!S.apiKey;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { flash('Could not save in this browser (storage is blocked or full).'); } }
  function view() { // what to display: real state in live mode, demo otherwise
    if (live()) return S;
    return { ...S, holdings: DEMO.holdings, quotes: { ...DEMO.quotes }, series: DEMO.series, fx: DEMO.fx, watch: ['XIU.TRT', 'SPY', 'QQQ'] };
  }

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs) { const v = attrs[k]; if (v == null || v === false) continue; if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    e.append(...kids.flat().filter(x => x != null)); return e;
  }
  const fmtCAD = n => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
  const fmtMoney = (n, cur) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-CA', { style: 'currency', currency: cur, currencyDisplay: 'symbol' });
  const fmtPct = n => n == null || !Number.isFinite(n) ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  const signed = n => n == null || !Number.isFinite(n) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + fmtCAD(Math.abs(n));
  const tone = n => n > 0 ? 'up' : n < 0 ? 'down' : '';
  function ago(t) { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago'; }
  function flash(t, where = 'msg') { const m = $(where); if (m) m.textContent = t; }
  const today = () => new Date().toISOString().slice(0, 10);
  function usageLeft() { if (S.usage.day !== today()) S.usage = { day: today(), count: 0 }; return DAILY_LIMIT - S.usage.count; }

  /* ---------- data provider ---------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let lastCall = 0;
  async function av(params) {
    if (usageLeft() <= 0) throw new Error('You’ve used today’s 25 free requests. Cached prices are shown.');
    const wait = 1300 - (Date.now() - lastCall); if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const url = 'https://www.alphavantage.co/query?' + new URLSearchParams({ ...params, apikey: S.apiKey });
    S.usage.count++; save();
    const res = await fetch(url);
    if (!res.ok) throw new Error('The data provider returned an error (' + res.status + ').');
    const json = await res.json();
    const problem = C.apiProblem(json);
    if (problem && !json['Global Quote'] && !json['Realtime Currency Exchange Rate'] && !json['Time Series (Daily)'] && !json.bestMatches) throw new Error(problem);
    return json;
  }
  async function fetchQuote(sym) { const q = C.parseQuote(await av({ function: 'GLOBAL_QUOTE', symbol: sym })); if (!q) throw new Error('No quote found for ' + sym + '. Check the symbol.'); S.quotes[sym] = { ...q, fetchedAt: Date.now() }; }
  async function fetchFx() { const f = C.parseFx(await av({ function: 'CURRENCY_EXCHANGE_RATE', from_currency: 'USD', to_currency: 'CAD' })); if (f) S.fx = { rate: f.rate, fetchedAt: Date.now() }; }
  async function fetchSeries(sym) { const p = C.parseDaily(await av({ function: 'TIME_SERIES_DAILY', symbol: sym, outputsize: 'compact' })); if (p) S.series[sym] = { points: p, fetchedAt: Date.now() }; }

  let refreshing = false;
  async function refresh(force) {
    if (!live()) { flash('Demo mode shows sample prices. Add your API key in Settings for live quotes.'); return; }
    if (refreshing) return; refreshing = true;
    const btn = $('refresh'); btn.disabled = true; btn.textContent = 'Refreshing…';
    const syms = [...new Set([...S.holdings.map(h => h.symbol), ...S.watch])];
    const due = syms.filter(s => force || !S.quotes[s] || Date.now() - S.quotes[s].fetchedAt > QUOTE_TTL);
    const needFx = S.holdings.some(h => C.currencyFor(h.symbol) === 'USD' || h.costCurrency === 'USD') && (!S.fx || Date.now() - S.fx.fetchedAt > FX_TTL);
    let done = 0, failed = null;
    try {
      if (needFx) { await fetchFx(); save(); render(); }
      for (const s of due) {
        try { await fetchQuote(s); done++; save(); render(); }
        catch (e) { failed = e.message; if (/25 free|limit/.test(e.message)) break; }
      }
      S.lastRefresh = Date.now(); save();
      flash(failed ? failed : done ? `Updated ${done} price${done === 1 ? '' : 's'}.` : 'Prices are already up to date.');
    } catch (e) { flash(e.message); }
    finally { refreshing = false; btn.disabled = false; btn.textContent = 'Refresh prices'; render(); }
  }

  /* ---------- rendering ---------- */
  let selected = null;
  function render() {
    const V = view();
    const usd = V.fx && V.fx.rate;
    const sum = C.summarize(V.holdings, V.quotes, usd);
    document.body.classList.toggle('is-demo', !live());
    $('mode-badge').textContent = live() ? 'Live · delayed quotes' : 'Demo';
    $('mode-badge').className = 'badge ' + (live() ? 'live' : '');
    $('demo-banner').hidden = live();
    $('refresh').hidden = !live();

    $('s-value').textContent = fmtCAD(sum.value);
    const day = $('s-day'); day.textContent = `${signed(sum.dayChange)} (${fmtPct(sum.dayPct)}) today`; day.className = 'delta ' + tone(sum.dayChange);
    const g = $('s-gain'); g.textContent = signed(sum.gain); g.className = 'num ' + tone(sum.gain);
    $('s-gainpct').textContent = fmtPct(sum.gainPct) + ' on cost';
    $('s-cost').textContent = fmtCAD(sum.cost);
    $('s-count').textContent = `${sum.priced} of ${V.holdings.length} holdings priced`;
    $('s-fx').textContent = usd ? usd.toFixed(4) : '—';
    $('s-fxtime').textContent = V.fx ? (V.fx.demo ? 'sample rate' : 'updated ' + ago(V.fx.fetchedAt)) : 'not loaded yet';
    $('updated').textContent = live() ? 'Prices refreshed ' + ago(S.lastRefresh) : 'Sample prices';

    // market watch
    $('watch').replaceChildren(...V.watch.map(sym => {
      const q = V.quotes[sym];
      return el('div', { class: 'chip' }, el('span', { class: 'sym', text: sym }), el('span', { class: 'num', text: q ? fmtMoney(q.price, C.currencyFor(sym)) : '—' }), el('span', { class: 'num ' + tone(q && q.changePct), text: q ? fmtPct(q.changePct) : 'not loaded' }));
    }));

    // holdings table
    $('empty').hidden = sum.rows.length > 0;
    $('rows').replaceChildren(...sum.rows.map((r, i) => {
      const q = r.quote;
      const tr = el('tr', { tabindex: '0', class: r.symbol === selected ? 'sel' : '', 'aria-label': `Show details for ${r.symbol}` },
        el('td', {}, el('span', { class: 'dot', style: `background:${COLORS[i % COLORS.length]}` }), el('b', { text: r.symbol }), el('small', { text: (S.names[r.symbol] || r.currency) })),
        el('td', { class: 'num', text: q ? fmtMoney(q.price, r.currency) : '—' }),
        el('td', { class: 'num ' + tone(q && q.changePct), text: q ? fmtPct(q.changePct) : '—' }),
        el('td', { class: 'num', text: String(r.shares) }),
        el('td', { class: 'num', text: fmtCAD(r.valueCAD) }),
        el('td', { class: 'num ' + tone(r.gainCAD) }, signed(r.gainCAD), el('small', { text: fmtPct(r.gainPct) })),
        el('td', { class: 'num', text: r.weight.toFixed(1) + '%' }));
      const open = () => { selected = r.symbol; render(); showDetail(r.symbol); };
      tr.addEventListener('click', open); tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      return tr;
    }));

    // donut
    drawDonut(sum.rows.filter(r => r.weight > 0));
    $('d-count').textContent = sum.rows.length;
    $('legend').replaceChildren(...sum.rows.map((r, i) => el('li', {}, el('span', { class: 'dot', style: `background:${COLORS[i % COLORS.length]}` }), el('span', { text: r.symbol }), el('span', { class: 'num', text: r.weight.toFixed(1) + '%' }))));
  }

  function drawDonut(rows) {
    const svg = $('donut'); svg.replaceChildren();
    const R = 48, CX = 60, CY = 60, W = 16, circ = 2 * Math.PI * R;
    const ns = 'http://www.w3.org/2000/svg';
    const base = document.createElementNS(ns, 'circle');
    Object.entries({ cx: CX, cy: CY, r: R, fill: 'none', stroke: 'var(--line)', 'stroke-width': W }).forEach(([k, v]) => base.setAttribute(k, v)); svg.append(base);
    let off = 0;
    rows.forEach((r, i) => {
      const len = circ * r.weight / 100;
      const c = document.createElementNS(ns, 'circle');
      Object.entries({ cx: CX, cy: CY, r: R, fill: 'none', stroke: COLORS[i % COLORS.length], 'stroke-width': W, 'stroke-dasharray': `${Math.max(len - 1.5, 0)} ${circ}`, 'stroke-dashoffset': -off, transform: `rotate(-90 ${CX} ${CY})` }).forEach(([k, v]) => c.setAttribute(k, v));
      svg.append(c); off += len;
    });
    svg.setAttribute('aria-label', 'Allocation: ' + rows.map(r => `${r.symbol} ${r.weight.toFixed(1)}%`).join(', '));
  }

  async function showDetail(sym) {
    const V = view();
    const h = V.holdings.find(x => x.symbol === sym);
    $('d-title').textContent = sym + (S.names[sym] ? ' · ' + S.names[sym] : '');
    $('d-actions').hidden = !live();
    let ser = V.series[sym];
    if (live() && (!ser || Date.now() - ser.fetchedAt > SERIES_TTL)) {
      $('d-sub').textContent = 'Loading price history…';
      try { await fetchSeries(sym); save(); ser = S.series[sym]; } catch (e) { $('d-sub').textContent = e.message; }
    }
    if (selected !== sym) return;
    const q = V.quotes[sym] || S.quotes[sym];
    const cur = C.currencyFor(sym);
    $('d-sub').textContent = ser ? `Last ${ser.points.length} trading days · ${cur}` + (live() ? '' : ' · sample data') : 'No history loaded.';
    drawChart(ser ? ser.points : [], h ? h.avgCost : null, cur);
    const fx = V.fx && V.fx.rate;
    const facts = [
      ['Last price', q ? fmtMoney(q.price, cur) : '—'], ['Previous close', q ? fmtMoney(q.prevClose, cur) : '—'],
      ['Day range', q && q.low ? `${fmtMoney(q.low, cur)} – ${fmtMoney(q.high, cur)}` : '—'],
      ['Your average cost', h ? fmtMoney(h.avgCost, h.costCurrency) : '—'], ['Shares', h ? String(h.shares) : '—'],
      ['Position value', h && q ? fmtCAD(C.toCAD(h.shares * q.price, cur, fx)) : '—'],
      ['Quote date', q ? (q.latestDay || '—') + (q.demo ? ' (sample)' : '') : '—'],
    ];
    $('facts').replaceChildren(...facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { class: 'num', text: v })]));
  }

  function drawChart(points, avgCost, cur) {
    const box = $('chart');
    if (!points.length) { box.replaceChildren(el('p', { class: 'sub', text: 'No price history yet.' })); return; }
    const W = 720, H = 240, P = { l: 56, r: 16, t: 14, b: 26 };
    const vals = points.map(p => p[1]).concat(avgCost ? [avgCost] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const x = i => P.l + i * (W - P.l - P.r) / (points.length - 1);
    const y = v => P.t + (hi - v) * (H - P.t - P.b) / (hi - lo);
    const up = points[points.length - 1][1] >= points[0][1];
    const stroke = up ? 'var(--up)' : 'var(--down)';
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1).toFixed(1)},${H - P.b}L${P.l},${H - P.b}Z`;
    const ticks = [0, 1, 2, 3].map(k => lo + (hi - lo) * k / 3);
    const ns = 'http://www.w3.org/2000/svg';
    const mk = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Closing prices from ${points[0][0]} to ${points[points.length - 1][0]}, ${up ? 'up' : 'down'} ${fmtPct((points[points.length - 1][1] / points[0][1] - 1) * 100)}` });
    const grad = mk('linearGradient', { id: 'g', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(mk('stop', { offset: '0%', 'stop-color': up ? '#5fd6a0' : '#ff8f84', 'stop-opacity': '0.28' }), mk('stop', { offset: '100%', 'stop-color': up ? '#5fd6a0' : '#ff8f84', 'stop-opacity': '0' }));
    const defs = mk('defs', {}); defs.append(grad); svg.append(defs);
    ticks.forEach(v => { svg.append(mk('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': 1 })); const t = mk('text', { x: P.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }); t.textContent = v.toFixed(v < 10 ? 2 : 0); svg.append(t); });
    [0, Math.floor(points.length / 2), points.length - 1].forEach(i => { const t = mk('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle', class: 'axis' }); t.textContent = points[i][0].slice(5); svg.append(t); });
    svg.append(mk('path', { d: area, fill: 'url(#g)' }), mk('path', { d: line, fill: 'none', stroke, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    if (avgCost && avgCost > lo && avgCost < hi) { svg.append(mk('line', { x1: P.l, x2: W - P.r, y1: y(avgCost), y2: y(avgCost), stroke: 'var(--muted)', 'stroke-dasharray': '4 4', 'stroke-width': 1 })); const t = mk('text', { x: W - P.r, y: y(avgCost) - 6, 'text-anchor': 'end', class: 'axis' }); t.textContent = 'your avg cost'; svg.append(t); }
    const last = points.length - 1; svg.append(mk('circle', { cx: x(last), cy: y(points[last][1]), r: 4, fill: stroke }));
    const hover = mk('g', { visibility: 'hidden' }); const hl = mk('line', { y1: P.t, y2: H - P.b, stroke: 'var(--muted)', 'stroke-width': 1 }); const hd = mk('circle', { r: 4, fill: stroke }); const ht = mk('text', { class: 'tip', y: P.t + 12 }); hover.append(hl, hd, ht); svg.append(hover);
    svg.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * W / r.width;
      const i = Math.max(0, Math.min(last, Math.round((px - P.l) / ((W - P.l - P.r) / last))));
      hover.setAttribute('visibility', 'visible'); hl.setAttribute('x1', x(i)); hl.setAttribute('x2', x(i)); hd.setAttribute('cx', x(i)); hd.setAttribute('cy', y(points[i][1]));
      ht.textContent = `${points[i][0]}  ${fmtMoney(points[i][1], cur)}`; ht.setAttribute('x', Math.min(Math.max(x(i), P.l + 90), W - P.r - 90)); ht.setAttribute('text-anchor', 'middle');
    });
    svg.addEventListener('pointerleave', () => hover.setAttribute('visibility', 'hidden'));
    box.replaceChildren(svg);
  }

  /* ---------- form ---------- */
  $('f-symbol').addEventListener('input', () => {
    const s = $('f-symbol').value.trim().toUpperCase();
    $('f-cur').value = C.currencyFor(s);
    scheduleSearch(s);
  });
  let searchTimer = null; const searchCache = {};
  function scheduleSearch(q) {
    clearTimeout(searchTimer); const box = $('suggest');
    if (!live() || q.length < 2 || q.includes('.')) { box.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      try {
        const res = searchCache[q] || (searchCache[q] = C.parseSearch(await av({ function: 'SYMBOL_SEARCH', keywords: q })));
        const hits = res.filter(m => /United States|Toronto|Canada/.test(m.region)).slice(0, 6);
        box.replaceChildren(...hits.map(m => el('li', { role: 'option', tabindex: '-1', onclick: () => { $('f-symbol').value = m.symbol; $('f-cur').value = C.currencyFor(m.symbol); S.names[m.symbol] = m.name; box.hidden = true; $('f-shares').focus(); } }, el('b', { text: m.symbol }), el('span', { text: `${m.name} · ${m.region}` }))));
        box.hidden = hits.length === 0;
      } catch (e) { box.hidden = true; flash(e.message); }
    }, 900);
  }
  $('form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!live()) { flash('You’re in demo mode. Add your API key in Settings to track your own holdings.'); return; }
    try {
      const symbol = $('f-symbol').value.trim().toUpperCase();
      if (!C.validSymbol(symbol)) throw new Error('Enter a symbol like SHOP.TRT or AAPL.');
      const shares = C.parseAmount($('f-shares').value, 'Shares', { positive: true });
      const avgCost = C.parseAmount($('f-cost').value, 'Average cost');
      const h = { symbol, shares, avgCost, costCurrency: $('f-cur').value };
      const i = S.holdings.findIndex(x => x.symbol === symbol);
      if (i >= 0) S.holdings[i] = h; else S.holdings.push(h);
      save(); $('form').reset(); $('suggest').hidden = true; render();
      flash(`${symbol} saved in this browser.`);
      try {
        if ((C.currencyFor(symbol) === 'USD' || h.costCurrency === 'USD') && !S.fx) { await fetchFx(); save(); render(); }
        if (!S.quotes[symbol]) { await fetchQuote(symbol); save(); render(); }
      } catch (err) { flash(err.message); }
    } catch (err) { flash(err.message); }
  });
  $('d-edit').addEventListener('click', () => {
    const h = S.holdings.find(x => x.symbol === selected); if (!h) return;
    $('f-symbol').value = h.symbol; $('f-shares').value = h.shares; $('f-cost').value = h.avgCost; $('f-cur').value = h.costCurrency; $('f-shares').focus();
  });
  let armed = false;
  $('d-remove').addEventListener('click', e => {
    if (!armed) { armed = true; e.target.textContent = 'Tap again to remove'; setTimeout(() => { armed = false; e.target.textContent = 'Remove'; }, 3000); return; }
    S.holdings = S.holdings.filter(x => x.symbol !== selected); save(); flash(selected + ' removed.'); selected = null; armed = false; e.target.textContent = 'Remove';
    $('chart').replaceChildren(el('p', { class: 'sub', text: 'No holding selected.' })); $('facts').replaceChildren(); $('d-title').textContent = 'Price history'; render();
  });

  /* ---------- settings ---------- */
  const dlg = $('settings');
  function openSettings() {
    $('s-key').value = S.apiKey; $('s-watch').value = S.watch.join(', ');
    $('s-usage').textContent = `Requests used today: ${DAILY_LIMIT - usageLeft()} of ${DAILY_LIMIT} (free plan).`; flash('', 's-msg');
    dlg.showModal();
  }
  $('open-settings').addEventListener('click', openSettings); $('banner-settings').addEventListener('click', openSettings);
  $('edit-watch').addEventListener('click', openSettings);
  $('s-save').addEventListener('click', e => {
    e.preventDefault();
    const wasLive = live();
    S.apiKey = $('s-key').value.trim();
    const w = $('s-watch').value.split(',').map(s => s.trim().toUpperCase()).filter(C.validSymbol).slice(0, 6);
    if (w.length) S.watch = w;
    save(); dlg.close(); render();
    if (live() && !wasLive) refresh(false);
  });
  $('export').addEventListener('click', () => {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), holdings: S.holdings, watch: S.watch }, null, 2);
    const a = el('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/json' })), download: 'investing-tracker.json' }); a.click();
    flash('Exported holdings (your API key is not included).', 's-msg');
  });
  $('import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text()); if (!Array.isArray(d.holdings)) throw new Error('That file has no holdings list.');
      S.holdings = d.holdings.filter(h => C.validSymbol(h.symbol) && h.shares > 0).map(h => ({ symbol: String(h.symbol).toUpperCase(), shares: Number(h.shares), avgCost: Number(h.avgCost ?? h.average_cost ?? 0), costCurrency: h.costCurrency || C.currencyFor(h.symbol) }));
      if (Array.isArray(d.watch)) S.watch = d.watch.filter(C.validSymbol).slice(0, 6);
      save(); render(); flash(`Imported ${S.holdings.length} holdings.`, 's-msg');
    } catch (err) { flash('Import failed: ' + err.message, 's-msg'); }
    e.target.value = '';
  });
  $('load-demo').addEventListener('click', () => { S.holdings = DEMO.holdings.map(h => ({ ...h })); save(); render(); flash('Demo holdings copied into your portfolio.', 's-msg'); });
  let clearArmed = false;
  $('clear').addEventListener('click', e => {
    if (!clearArmed) { clearArmed = true; e.target.textContent = 'Click again to clear'; setTimeout(() => { clearArmed = false; e.target.textContent = 'Clear my holdings'; }, 3000); return; }
    S.holdings = []; save(); render(); clearArmed = false; e.target.textContent = 'Clear my holdings'; flash('Holdings cleared.', 's-msg');
  });
  $('refresh').addEventListener('click', () => refresh(false));

  /* ---------- start ---------- */
  render();
  const first = view().holdings[0]; if (first) { selected = first.symbol; render(); showDetail(first.symbol); }
  if (live() && Date.now() - S.lastRefresh > AUTO_REFRESH_AFTER) refresh(false);
})();
