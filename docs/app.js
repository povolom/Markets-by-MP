// Markets by MP: browser app. Your key and holdings live in localStorage on this device only.
(function () {
  'use strict';
  const C = window.Calc;
  const KEY = 'markets-v1';
  const OLD_KEYS = ['investing-tracker-v1', 'portfolio-lab-v1']; // earlier names of this app
  const DAILY_LIMIT = 25;
  const QUOTE_TTL = 30 * 60 * 1000;       // re-fetch a quote after 30 minutes
  const FX_TTL = 6 * 60 * 60 * 1000;      // USD/CAD every 6 hours
  const SERIES_TTL = 12 * 60 * 60 * 1000; // daily history twice a day
  const AUTO_REFRESH_AFTER = 4 * 60 * 60 * 1000;
  const KEEP_FOR_QUOTES = 6;              // never spend the last few requests on charts
  const COLORS = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#64748b', '#14b8a6', '#d946ef', '#84cc16', '#6366f1'];
  const EMBED = document.documentElement.classList.contains('embed');

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
      ['SHOP.TRT', 12, 98.40, 'CAD', 118.25, 0.12, 11, 'Shopify Inc.'],
      ['RY.TRT', 15, 142.10, 'CAD', 171.60, 0.08, 23, 'Royal Bank of Canada'],
      ['XIU.TRT', 40, 33.20, 'CAD', 38.45, 0.06, 37, 'iShares S&P/TSX 60 ETF'],
      ['AAPL', 6, 180.00, 'USD', 226.30, 0.05, 41, 'Apple Inc.'],
      ['NVDA', 10, 95.00, 'USD', 131.80, 0.18, 53, 'NVIDIA Corp.'],
    ];
    const holdings = [], quotes = {}, series = {}, names = {};
    for (const [symbol, shares, avgCost, costCurrency, price, drift, seed, name] of list) {
      holdings.push({ symbol, shares, avgCost, costCurrency }); names[symbol] = name;
      const s = demoSeries(price, seed, drift);
      series[symbol] = { points: s, fetchedAt: Date.now() };
      const prev = s[s.length - 2][1];
      quotes[symbol] = { price, prevClose: prev, change: price - prev, changePct: (price - prev) / prev * 100, high: price * 1.01, low: price * 0.985, volume: 0, latestDay: s[s.length - 1][0], fetchedAt: Date.now(), demo: true };
    }
    for (const [symbol, price, seed, name] of [['SPY', 571.20, 61, 'SPDR S&P 500 ETF'], ['QQQ', 489.55, 67, 'Invesco QQQ Trust']]) {
      const s = demoSeries(price, seed, 0.07); const prev = s[s.length - 2][1];
      quotes[symbol] = { price, prevClose: prev, change: price - prev, changePct: (price - prev) / prev * 100, fetchedAt: Date.now(), demo: true };
      series[symbol] = { points: s, fetchedAt: Date.now() }; names[symbol] = name;
    }
    return { holdings, quotes, series, names, fx: { rate: 1.37, fetchedAt: Date.now(), demo: true } };
  })();

  /* ---------- state ---------- */
  // apiKey = Alpha Vantage (Toronto prices and charts), fhKey = Finnhub (live US prices)
  function blank() { return { apiKey: '', fhKey: '', watch: ['XIU.TRT', 'SPY', 'QQQ'], holdings: [], quotes: {}, series: {}, fx: null, names: {}, usage: { day: '', count: 0 }, lastRefresh: 0, onboarded: false, range: 91 }; }
  function load() {
    for (const k of [KEY, ...OLD_KEYS]) {
      try {
        const s = JSON.parse(localStorage.getItem(k));
        if (s && typeof s === 'object') {
          const state = Object.assign(blank(), s);
          if (k !== KEY) { state.onboarded = !!state.apiKey; localStorage.setItem(KEY, JSON.stringify(state)); } // carry data over from the old name
          return state;
        }
      } catch (e) { /* storage blocked or bad data: start fresh */ }
    }
    return blank();
  }
  let S = load();
  const hasAV = () => !!S.apiKey;
  const hasFH = () => !!S.fhKey;
  const live = () => hasAV() || hasFH();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { flash('Could not save in this browser (storage is blocked or full).'); } }
  function view() { // what to display: your real state in live mode, the demo otherwise
    if (live()) return S;
    return { ...S, holdings: DEMO.holdings, quotes: { ...DEMO.quotes }, series: DEMO.series, fx: DEMO.fx, names: DEMO.names, watch: ['XIU.TRT', 'SPY', 'QQQ'] };
  }

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs) { const v = attrs[k]; if (v == null || v === false) continue; if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    e.append(...kids.flat().filter(x => x != null)); return e;
  }
  const NONE = '–';
  const fmtCAD = n => n == null || !Number.isFinite(n) ? NONE : n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
  const fmtMoney = (n, cur) => n == null || !Number.isFinite(n) ? NONE : n.toLocaleString('en-CA', { style: 'currency', currency: cur, currencyDisplay: 'symbol' });
  const fmtPct = n => n == null || !Number.isFinite(n) ? NONE : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  const signed = n => n == null || !Number.isFinite(n) ? NONE : (n > 0 ? '+' : n < 0 ? '−' : '') + fmtCAD(Math.abs(n));
  const tone = n => n > 0 ? 'up' : n < 0 ? 'down' : '';
  const ticker = sym => sym.split('.')[0].slice(0, 4);
  const market = sym => C.currencyFor(sym) === 'CAD' ? 'Toronto' : 'US';
  function ago(t) { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago'; }
  function flash(t, where = 'msg') { const m = $(where); if (m) m.textContent = t; }
  const today = () => new Date().toISOString().slice(0, 10);
  function usageLeft() { if (S.usage.day !== today()) S.usage = { day: today(), count: 0 }; return DAILY_LIMIT - S.usage.count; }
  const colorFor = (sym, list) => COLORS[Math.max(0, list.indexOf(sym)) % COLORS.length];

  /* ---------- data providers ----------
     Finnhub: live US prices, 60 requests a minute, no daily cap.
     Alpha Vantage: Toronto (TSX) prices and daily history, 25 requests a day.
     Frankfurter: USD to CAD reference rate, no key, no limit. */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isUS = sym => C.currencyFor(sym) === 'USD';
  let fhCalls = [];
  async function fh(path, params) {
    fhCalls = fhCalls.filter(t => Date.now() - t < 60000);
    if (fhCalls.length >= 55) await sleep(60000 - (Date.now() - fhCalls[0]) + 200); // stay under 60 a minute
    fhCalls.push(Date.now());
    const res = await fetch(`https://finnhub.io/api/v1/${path}?` + new URLSearchParams({ ...params, token: S.fhKey }));
    if (res.status === 401 || res.status === 403) throw new Error('Finnhub didn’t accept that key. Check it in Settings.');
    if (res.status === 429) throw new Error('Finnhub says slow down for a minute.');
    if (!res.ok) throw new Error('Finnhub returned an error (' + res.status + ').');
    return res.json();
  }
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
  async function fetchQuote(sym) {
    let q;
    if (isUS(sym) && hasFH()) q = C.parseFinnhubQuote(await fh('quote', { symbol: sym }));
    else if (hasAV()) q = C.parseQuote(await av({ function: 'GLOBAL_QUOTE', symbol: sym }));
    else throw new Error(`Toronto prices like ${sym} need a free Alpha Vantage key (Settings).`);
    if (!q) throw new Error('No quote found for ' + sym + '. Check the symbol.');
    S.quotes[sym] = { ...q, fetchedAt: Date.now(), live: isUS(sym) && hasFH() };
  }
  async function fetchFx() {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=CAD');
    const f = res.ok ? C.parseFrankfurter(await res.json()) : null;
    if (!f) throw new Error('Couldn’t load the USD to CAD rate. Try again later.');
    S.fx = { rate: f.rate, fetchedAt: Date.now(), at: f.at };
  }
  async function fetchSeries(sym) {
    if (!hasAV()) return;
    const p = C.parseDaily(await av({ function: 'TIME_SERIES_DAILY', symbol: sym, outputsize: 'compact' }));
    if (p) S.series[sym] = { points: p, fetchedAt: Date.now() };
  }
  const stale = (x, ttl) => !x || Date.now() - x.fetchedAt > ttl;
  const LIVE_TTL = 50 * 1000; // US prices from Finnhub refresh about once a minute
  const quoteTTL = sym => isUS(sym) && hasFH() ? LIVE_TTL : QUOTE_TTL;

  let refreshing = false;
  async function refresh(force, quiet) {
    if (!live()) { flash('The demo uses sample prices. Add your free key in Settings for live ones.'); return; }
    if (refreshing) return; refreshing = true;
    const btn = $('refresh'); btn.disabled = true; btn.classList.add('spin');
    const syms = [...new Set([...S.holdings.map(h => h.symbol), ...S.watch])];
    const due = syms.filter(s => (isUS(s) ? hasFH() || hasAV() : hasAV()) && (force || stale(S.quotes[s], quoteTTL(s))));
    const needFx = S.holdings.some(h => isUS(h.symbol) || h.costCurrency === 'USD') && stale(S.fx, FX_TTL);
    let done = 0, failed = null;
    try {
      if (needFx) { try { await fetchFx(); save(); render(); } catch (e) { failed = e.message; } }
      for (const s of due) {
        try { await fetchQuote(s); done++; save(); render(); }
        catch (e) { failed = e.message; if (/25 free|limit/.test(e.message) && !isUS(s)) continue; }
      }
      // Charts: daily history for each holding (Alpha Vantage), only while requests are left over.
      if (hasAV()) for (const h of S.holdings) {
        if (!stale(S.series[h.symbol], SERIES_TTL) || usageLeft() <= KEEP_FOR_QUOTES) continue;
        try { await fetchSeries(h.symbol); save(); render(); } catch (e) { failed = failed || e.message; break; }
      }
      S.lastRefresh = Date.now(); save();
      if (!quiet || failed) flash(failed ? failed : done ? `Updated ${done} price${done === 1 ? '' : 's'}.` : 'Prices are already up to date.');
    } catch (e) { flash(e.message); }
    finally { refreshing = false; btn.disabled = false; btn.classList.remove('spin'); render(); }
  }
  // Live US prices: while the app is open and visible, refresh them about once a minute.
  setInterval(() => { if (hasFH() && document.visibilityState === 'visible') refresh(false, true); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (hasFH() && document.visibilityState === 'visible') refresh(false, true); });

  /* ---------- rendering ---------- */
  let selected = null;
  function render() {
    const V = view();
    const usd = V.fx && V.fx.rate;
    const sum = C.summarize(V.holdings, V.quotes, usd);
    const order = sum.rows.map(r => r.symbol);
    $('mode-badge').textContent = hasFH() ? 'Live' : hasAV() ? 'Delayed' : 'Demo';
    $('mode-badge').className = 'mode' + (live() ? ' live' : '');
    $('demo-banner').hidden = live();
    $('refresh').hidden = !live();

    $('s-value').textContent = fmtCAD(sum.value);
    const day = $('s-day'); day.textContent = sum.priced ? `${signed(sum.dayChange)} (${fmtPct(sum.dayPct)}) today` : 'No prices yet'; day.className = 'change num ' + tone(sum.dayChange);
    const g = $('s-gain'); g.textContent = signed(sum.gain); g.className = 'num ' + tone(sum.gain);
    $('s-gainpct').textContent = fmtPct(sum.gainPct);
    $('s-cost').textContent = fmtCAD(sum.cost);
    $('s-count').textContent = `${sum.priced} of ${V.holdings.length} priced`;
    $('s-fx').textContent = usd ? usd.toFixed(4) : NONE;
    $('s-fxtime').textContent = V.fx ? (V.fx.demo ? 'sample rate' : 'updated ' + ago(V.fx.fetchedAt)) : 'not loaded yet';
    $('updated').textContent = live() ? 'Updated ' + ago(S.lastRefresh) : 'Sample prices';
    renderPortfolioChart(V, usd);

    $('empty').hidden = sum.rows.length > 0;
    $('rows').replaceChildren(...sum.rows.map(r => {
      const q = r.quote; const name = V.names[r.symbol];
      return row(r.symbol, colorFor(r.symbol, order), name || `${r.shares} shares · ${market(r.symbol)}`, name ? `${r.shares} shares` : null,
        fmtCAD(r.valueCAD), q ? fmtPct(q.changePct) : NONE, tone(q && q.changePct), r.symbol === selected);
    }));

    const weighted = sum.rows.filter(r => r.weight > 0);
    $('d-count').textContent = `${sum.rows.length} position${sum.rows.length === 1 ? '' : 's'}`;
    $('alloc-bar').replaceChildren(...weighted.map(r => el('span', { style: `width:${r.weight}%;background:${colorFor(r.symbol, order)}`, title: `${r.symbol} ${r.weight.toFixed(1)}%` })));
    $('alloc-bar').setAttribute('aria-label', 'Allocation: ' + weighted.map(r => `${r.symbol} ${r.weight.toFixed(1)}%`).join(', '));
    $('legend').replaceChildren(...weighted.map(r => el('li', {}, el('span', { class: 'dot', style: `background:${colorFor(r.symbol, order)}` }), el('span', { text: r.symbol }), el('span', { class: 'num', text: r.weight.toFixed(1) + '%' }))));

    $('watch').replaceChildren(...V.watch.map((sym, i) => {
      const q = V.quotes[sym];
      return row(sym, COLORS[(i + 5) % COLORS.length], V.names[sym] || market(sym), null, q ? fmtMoney(q.price, C.currencyFor(sym)) : NONE, q ? fmtPct(q.changePct) : 'not loaded', tone(q && q.changePct), false);
    }));
  }

  function row(sym, color, line, extra, amount, pct, toneClass, isSel) {
    const li = el('li', { tabindex: '0', role: 'button', class: isSel ? 'sel' : '', 'aria-label': `${sym}, ${amount}, ${pct} today. Show details.` },
      el('span', { class: 'avatar', style: `background:${color}`, text: ticker(sym) }),
      el('span', { class: 'who' }, el('b', { text: sym }), el('span', { text: extra ? `${line} · ${extra}` : line })),
      el('span', { class: 'amt num' }, el('b', { text: amount }), el('span', { class: 'pill ' + toneClass, text: pct })));
    const open = () => openDetail(sym);
    li.addEventListener('click', open);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return li;
  }

  function renderPortfolioChart(V, usd) {
    const series = Object.fromEntries(Object.entries(V.series).map(([k, v]) => [k, v.points]));
    const priced = V.holdings.filter(h => V.quotes[h.symbol]);
    const all = C.portfolioHistory(priced, series, usd);
    document.querySelectorAll('#ranges button').forEach(b => b.setAttribute('aria-selected', String(Number(b.dataset.days) === S.range)));
    if (all.length < 2) {
      const why = !live() ? 'No history yet.' : !hasAV() ? 'Charts use daily prices from Alpha Vantage. Add your free Alpha Vantage key in Settings to see your portfolio over time.' : 'Your portfolio chart appears once price history has loaded. Refresh again later today.';
      $('pchart').replaceChildren(el('p', { class: 'empty-chart', text: why }));
      return;
    }
    const pts = C.lastDays(all, S.range);
    const first = pts[0][1], last = pts[pts.length - 1][1];
    drawChart('pchart', pts, { fmt: fmtCAD, caption: `${signed(last - first)} (${fmtPct((last / first - 1) * 100)}) ${rangeName(S.range)}` });
  }
  const rangeName = d => ({ 7: 'past week', 30: 'past month', 91: 'past 3 months', 0: 'since the first day loaded' })[d] || '';

  function drawChart(boxId, points, { ref = null, refLabel = '', fmt, caption = '' }) {
    const box = $(boxId);
    if (!points.length) { box.replaceChildren(el('p', { class: 'empty-chart', text: 'No price history yet.' })); return; }
    // Draw at the box's real width so labels stay readable on phones.
    const W = Math.max(280, Math.round(box.clientWidth || 720)), H = Math.round(Math.min(240, Math.max(170, W * 0.36))), P = { l: 8, r: 8, t: 12, b: 24 };
    const vals = points.map(p => p[1]).concat(ref ? [ref] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    const n = points.length - 1 || 1;
    const x = i => P.l + i * (W - P.l - P.r) / n;
    const y = v => P.t + (hi - v) * (H - P.t - P.b) / (hi - lo);
    const up = points[points.length - 1][1] >= points[0][1];
    const stroke = up ? 'var(--up)' : 'var(--down)';
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1).toFixed(1)},${H - P.b}L${P.l},${H - P.b}Z`;
    const ns = 'http://www.w3.org/2000/svg';
    const mk = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const gid = 'g-' + boxId;
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Chart from ${points[0][0]} to ${points[points.length - 1][0]}: ${caption || (up ? 'up' : 'down')}` });
    const grad = mk('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(mk('stop', { offset: '0%', 'stop-color': up ? '#10b981' : '#ef4444', 'stop-opacity': '0.22' }), mk('stop', { offset: '100%', 'stop-color': up ? '#10b981' : '#ef4444', 'stop-opacity': '0' }));
    const defs = mk('defs', {}); defs.append(grad); svg.append(defs);
    svg.append(mk('path', { d: area, fill: `url(#${gid})` }), mk('path', { d: line, fill: 'none', stroke, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    if (ref && ref > lo && ref < hi) {
      svg.append(mk('line', { x1: P.l, x2: W - P.r, y1: y(ref), y2: y(ref), stroke: 'var(--muted)', 'stroke-dasharray': '4 5', 'stroke-width': 1 }));
      const t = mk('text', { x: W - P.r, y: y(ref) - 6, 'text-anchor': 'end', class: 'axis' }); t.textContent = refLabel; svg.append(t);
    }
    [0, points.length - 1].forEach(i => { const t = mk('text', { x: x(i), y: H - 4, 'text-anchor': i === 0 ? 'start' : 'end', class: 'axis' }); t.textContent = shortDate(points[i][0]); svg.append(t); });
    const lastI = points.length - 1; svg.append(mk('circle', { cx: x(lastI), cy: y(points[lastI][1]), r: 4.5, fill: stroke }));
    const hover = mk('g', { visibility: 'hidden' }); const hl = mk('line', { y1: P.t, y2: H - P.b, stroke: 'var(--muted)', 'stroke-width': 1 }); const hd = mk('circle', { r: 5, fill: stroke }); const ht = mk('text', { class: 'tip', y: P.t + 2, 'text-anchor': 'middle' }); hover.append(hl, hd, ht); svg.append(hover);
    const move = e => {
      const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * W / r.width;
      const i = Math.max(0, Math.min(lastI, Math.round((px - P.l) / ((W - P.l - P.r) / n))));
      hover.setAttribute('visibility', 'visible'); hl.setAttribute('x1', x(i)); hl.setAttribute('x2', x(i)); hd.setAttribute('cx', x(i)); hd.setAttribute('cy', y(points[i][1]));
      ht.textContent = `${shortDate(points[i][0])}  ${fmt(points[i][1])}`; ht.setAttribute('x', Math.min(Math.max(x(i), 90), W - 90));
    };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => hover.setAttribute('visibility', 'hidden'));
    const kids = [svg];
    if (caption) kids.push(el('p', { class: 'sub num ' + (up ? 'up' : 'down'), text: caption }));
    box.replaceChildren(...kids);
  }
  function shortDate(iso) { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); }

  /* ---------- stock detail ---------- */
  async function openDetail(sym) {
    selected = sym; render();
    const dlg = $('detail'); if (!dlg.open) dlg.showModal();
    const V = view();
    const cur = C.currencyFor(sym);
    $('d-title').textContent = sym;
    $('d-name').textContent = (V.names[sym] ? V.names[sym] + ' · ' : '') + (cur === 'CAD' ? 'Toronto, CAD' : 'US, USD');
    $('d-actions').hidden = !live() || !S.holdings.some(h => h.symbol === sym);
    fillDetail(sym);
    if (live() && stale(V.series[sym], SERIES_TTL)) {
      $('d-sub').textContent = 'Loading price history…';
      try { await fetchSeries(sym); save(); } catch (e) { $('d-sub').textContent = e.message; }
      if (selected === sym) fillDetail(sym);
    }
  }
  function fillDetail(sym) {
    const V = view();
    const cur = C.currencyFor(sym);
    const q = V.quotes[sym];
    const h = V.holdings.find(x => x.symbol === sym);
    const ser = V.series[sym];
    $('d-price').textContent = q ? fmtMoney(q.price, cur) : NONE;
    const ch = $('d-change'); ch.textContent = q ? `${q.change >= 0 ? '+' : '−'}${fmtMoney(Math.abs(q.change), cur)} (${fmtPct(q.changePct)}) today` : 'No price yet'; ch.className = 'change num ' + tone(q && q.change);
    if (ser && ser.points.length) drawChart('chart', ser.points, { ref: h ? h.avgCost : null, refLabel: 'your average cost', fmt: v => fmtMoney(v, cur) });
    else $('chart').replaceChildren(el('p', { class: 'empty-chart', text: live() && !hasAV() ? 'Add your free Alpha Vantage key in Settings to see this chart.' : 'No price history yet.' }));
    $('d-sub').textContent = ser ? `Last ${ser.points.length} trading days, ${cur}` + (live() ? '' : ', sample data') : '';
    const fx = V.fx && V.fx.rate;
    const facts = (id, pairs) => $(id).replaceChildren(...pairs.map(([k, v, t]) => el('div', {}, el('dt', { text: k }), el('dd', { class: 'num ' + (t || ''), text: v }))));
    if (h) {
      const value = q ? C.toCAD(h.shares * q.price, cur, fx) : NaN;
      const cost = C.toCAD(h.shares * h.avgCost, h.costCurrency, fx);
      facts('position', [['Shares', String(h.shares)], ['Average cost', fmtMoney(h.avgCost, h.costCurrency)],
        ['Market value', fmtCAD(value)], ['Total return', Number.isFinite(value) ? `${signed(value - cost)} (${fmtPct((value / cost - 1) * 100)})` : NONE, tone(value - cost)]]);
    } else {
      $('position').replaceChildren(el('div', {}, el('dt', { text: 'You don’t own this one' }), el('dd', { text: 'It’s on your watchlist.' })));
    }
    facts('facts', [['Previous close', q ? fmtMoney(q.prevClose, cur) : NONE], ['Day range', q && q.low ? `${fmtMoney(q.low, cur)} to ${fmtMoney(q.high, cur)}` : NONE],
      ['Quote date', q ? (q.latestDay || NONE) + (q.demo ? ' (sample)' : '') : NONE], ['Market', cur === 'CAD' ? 'Toronto Stock Exchange' : 'United States']]);
  }

  /* ---------- dialogs ---------- */
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); }); // tap outside to close
    d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close()));
  });
  $('detail').addEventListener('close', () => { selected = null; render(); });

  function openAdd(h) {
    $('form').reset(); flash('', 'f-msg'); $('suggest').hidden = true;
    if (h) { $('f-symbol').value = h.symbol; $('f-shares').value = h.shares; $('f-cost').value = h.avgCost; $('f-cur').value = h.costCurrency; }
    $('add').showModal(); (h ? $('f-shares') : $('f-symbol')).focus();
  }
  $('open-add').addEventListener('click', () => openAdd());
  $('open-add-fab').addEventListener('click', () => openAdd());
  $('open-about').addEventListener('click', () => $('about').showModal());

  /* ---------- add or edit a holding ---------- */
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
        // Finnhub search is free and unlimited enough to use as you type; Alpha Vantage only if it's the only key.
        const res = searchCache[q] || (searchCache[q] = hasFH() ? C.parseFinnhubSearch(await fh('search', { q })) : C.parseSearch(await av({ function: 'SYMBOL_SEARCH', keywords: q })));
        const hits = res.filter(m => /United States|Toronto|Canada/.test(m.region)).slice(0, 6);
        box.replaceChildren(...hits.map(m => el('li', { role: 'option', tabindex: '-1', onclick: () => { $('f-symbol').value = m.symbol; $('f-cur').value = C.currencyFor(m.symbol); S.names[m.symbol] = m.name; box.hidden = true; $('f-shares').focus(); } }, el('b', { text: m.symbol }), el('span', { text: `${m.name} · ${m.region}` }))));
        box.hidden = hits.length === 0;
      } catch (e) { box.hidden = true; flash(e.message, 'f-msg'); }
    }, 900);
  }
  $('form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!live()) { flash('This is the demo. Add your free key in Settings to track your own holdings.', 'f-msg'); return; }
    try {
      const symbol = $('f-symbol').value.trim().toUpperCase();
      if (!C.validSymbol(symbol)) throw new Error('Enter a symbol like SHOP.TRT or AAPL.');
      const shares = C.parseAmount($('f-shares').value, 'Shares', { positive: true });
      const avgCost = C.parseAmount($('f-cost').value, 'Average cost');
      const h = { symbol, shares, avgCost, costCurrency: $('f-cur').value };
      const i = S.holdings.findIndex(x => x.symbol === symbol);
      if (i >= 0) S.holdings[i] = h; else S.holdings.push(h);
      save(); $('add').close(); render();
      flash(`${symbol} saved in this browser.`);
      try {
        if ((C.currencyFor(symbol) === 'USD' || h.costCurrency === 'USD') && !S.fx) { await fetchFx(); save(); render(); }
        if (!S.quotes[symbol]) { await fetchQuote(symbol); save(); render(); }
      } catch (err) { flash(err.message); }
    } catch (err) { flash(err.message, 'f-msg'); }
  });
  $('d-edit').addEventListener('click', () => {
    const h = S.holdings.find(x => x.symbol === selected); if (!h) return;
    $('detail').close(); openAdd(h);
  });
  let armed = false;
  $('d-remove').addEventListener('click', e => {
    if (!armed) { armed = true; e.target.textContent = 'Tap again to remove'; setTimeout(() => { armed = false; e.target.textContent = 'Remove'; }, 3000); return; }
    const sym = selected;
    S.holdings = S.holdings.filter(x => x.symbol !== sym); save(); armed = false; e.target.textContent = 'Remove';
    $('detail').close(); flash(sym + ' removed.'); render();
  });

  /* ---------- settings ---------- */
  function openSettings() {
    $('s-fh').value = S.fhKey; $('s-key').value = S.apiKey; $('s-watch').value = S.watch.join(', ');
    $('s-usage').textContent = `Requests used today: ${DAILY_LIMIT - usageLeft()} of ${DAILY_LIMIT} (free plan).`; flash('', 's-msg');
    $('settings').showModal();
  }
  $('open-settings').addEventListener('click', openSettings);
  $('banner-settings').addEventListener('click', () => openWelcome(2));
  $('edit-watch').addEventListener('click', openSettings);
  $('s-save').addEventListener('click', e => {
    e.preventDefault();
    const wasLive = live();
    S.apiKey = $('s-key').value.trim();
    S.fhKey = $('s-fh').value.trim();
    if (live()) S.onboarded = true;
    const w = $('s-watch').value.split(',').map(s => s.trim().toUpperCase()).filter(C.validSymbol).slice(0, 6);
    if (w.length) S.watch = w;
    save(); $('settings').close(); render();
    if (live() && !wasLive) refresh(false);
  });
  $('export').addEventListener('click', () => {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), holdings: S.holdings, watch: S.watch }, null, 2);
    const a = el('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/json' })), download: 'markets-by-mp.json' }); a.click();
    flash('Exported holdings (your key is not included).', 's-msg');
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
  $('load-demo').addEventListener('click', () => { S.holdings = DEMO.holdings.map(h => ({ ...h })); Object.assign(S.names, DEMO.names); save(); render(); flash('Demo holdings copied into your portfolio.', 's-msg'); });
  let clearArmed = false;
  $('clear').addEventListener('click', e => {
    if (!clearArmed) { clearArmed = true; e.target.textContent = 'Click again to clear'; setTimeout(() => { clearArmed = false; e.target.textContent = 'Clear my holdings'; }, 3000); return; }
    S.holdings = []; save(); render(); clearArmed = false; e.target.textContent = 'Clear my holdings'; flash('Holdings cleared.', 's-msg');
  });
  $('show-welcome').addEventListener('click', () => { $('settings').close(); openWelcome(1); });
  $('refresh').addEventListener('click', () => refresh(false));
  $('ranges').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.range = Number(b.dataset.days); save(); render(); });

  /* ---------- first-launch guide ---------- */
  const wdlg = $('welcome');
  function showStep(n) {
    wdlg.querySelectorAll('.wstep').forEach(s => { s.hidden = Number(s.dataset.step) !== n; });
    wdlg.querySelectorAll('.steps li').forEach(li => li.classList.toggle('on', Number(li.dataset.step) <= n));
    wdlg.dataset.step = n;
    if (n === 3) setTimeout(() => $('w-key').focus(), 50);
  }
  function openWelcome(n) { flash('', 'w-msg'); flash('', 'w-av-msg'); $('w-key').value = S.fhKey || ''; $('w-av').value = S.apiKey || ''; showStep(n); if (!wdlg.open) wdlg.showModal(); }
  wdlg.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => showStep(Number(wdlg.dataset.step) + 1)));
  wdlg.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => showStep(Number(wdlg.dataset.step) - 1)));
  wdlg.querySelector('[data-demo]').addEventListener('click', () => { S.onboarded = true; save(); wdlg.close(); });
  wdlg.addEventListener('close', () => { if (!S.onboarded) { S.onboarded = true; save(); } });
  function finishWelcome() {
    S.onboarded = true; save(); wdlg.close(); render();
    if (!S.holdings.length) { flash('Live prices are on. Add your first holding.'); openAdd(); } else refresh(true);
  }
  // Step 3: Finnhub key, checked with one free quote request.
  $('w-save').addEventListener('click', async () => {
    const key = $('w-key').value.trim();
    if (key.length < 8) { flash('Paste the key from Finnhub first.', 'w-msg'); return; }
    const before = S.fhKey; S.fhKey = key;
    const btn = $('w-save'); btn.disabled = true; flash('Checking your key…', 'w-msg');
    try {
      if (!C.parseFinnhubQuote(await fh('quote', { symbol: 'AAPL' }))) throw new Error('Finnhub answered, but with no price. Try again in a minute.');
      save(); showStep(4);
    } catch (e) { S.fhKey = before; save(); flash(e.message, 'w-msg'); }
    finally { btn.disabled = false; }
  });
  // Step 4 (optional): Alpha Vantage key for Toronto prices and charts.
  $('w-av-save').addEventListener('click', async () => {
    const key = $('w-av').value.trim();
    if (key.length < 8) { flash('Paste the key from Alpha Vantage, or skip this step.', 'w-av-msg'); return; }
    const before = S.apiKey; S.apiKey = key;
    const btn = $('w-av-save'); btn.disabled = true; flash('Checking your key with one request…', 'w-av-msg');
    try { await fetchQuote('XIU.TRT'); save(); finishWelcome(); }
    catch (e) { S.apiKey = before; save(); flash(e.message, 'w-av-msg'); }
    finally { btn.disabled = false; }
  });
  $('w-skip').addEventListener('click', finishWelcome);

  // Redraw charts when the window changes size (they're drawn at their real width).
  let resizeTimer; addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { render(); if (selected && $('detail').open) fillDetail(selected); }, 150); });

  /* ---------- start ---------- */
  render();
  if (!S.onboarded && !live() && !EMBED) openWelcome(1);
  else if (live() && Date.now() - S.lastRefresh > AUTO_REFRESH_AFTER) refresh(false);
  if ('serviceWorker' in navigator && !EMBED) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
