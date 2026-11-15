import { symbolOf } from '../lib/format';
import { useMemo, useState } from 'react';
import { api, useApi, isDesktopApp } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { CLASS_LABEL, SESSION_LABEL, dateFmt, money, priceFmt, signedPct, timeAgo } from '../lib/format';
import { useMe } from '../components/Shell';
import { LineChart } from '../components/Chart';
import { InstrumentPicker } from '../components/InstrumentPicker';
import { AssetCell, Change, ClassLabel, DataBadge, Dialog, Empty, ErrorState, Icon, Loading, LockedPanel, LockedPrice, Price, Seg, Spark, useToast } from '../components/ui';
import { RuleDialog } from './dips';
import { AddAssets } from '../components/AddAssets';
import { OtherListings } from '../components/AssetSearch';

// ---------------- Overview ----------------
export function Overview() {
  const { me } = useMe();
  const pfs = useApi<{ data: any[] }>('/portfolios');
  const first = pfs.data?.data.find(p => p.transactionCount > 0);
  const pf = useApi<{ data: any }>(first ? `/portfolios/${first.id}` : null, [first?.id]);
  const wl = useApi<{ data: any[] }>('/watchlists');
  const brief = useApi<{ data: any }>('/brief');
  const ov = useApi<{ data: any }>('/markets/overview');
  const hasHoldings = (pf.data?.data.summary.holdings.length ?? 0) > 0;
  const s = pf.data?.data.summary;
  return (
    <>
      <div className="page-head"><div><h1>{greeting()}{me?.displayName && me.displayName !== 'Guest' ? `, ${me.displayName}` : ''}</h1><p>{hasHoldings ? 'Your portfolio, what you follow, and what\'s coming up.' : 'Start with a watchlist. No holdings or bank connection needed.'}</p></div><DataBadge meta={ov.data?.data.meta} /></div>
      {hasHoldings && s && <PortfolioHero pid={first!.id} d={pf.data!.data} />}
      <div className="grid-2">
        <div className="card flush">
          <div className="card-head"><h2>Watchlists</h2><Link to="/app/watchlists" className="btn ghost sm">Manage</Link></div>
          {wl.loading && !wl.data ? <div style={{ padding: 18 }}><Loading /></div> : wl.data?.data.length ? (
            <table className="t responsive"><tbody>{wl.data.data.flatMap(l => l.items).slice(0, 7).map((i: any) => <tr key={i.instrumentId}><td><AssetCell inst={i.instrument} /></td><td className="hide-m"><Spark values={i.sparkline} w={80} h={26} /></td><td className="r">{i.quote?.locked ? <LockedPrice reason={i.quote.lockReason} /> : <><Price value={i.quote?.price} /><br /><Change pct={i.quote?.changePct} /></>}</td></tr>)}</tbody></table>
          ) : <Empty title="No watchlists yet" action={<Link to="/app/watchlists" className="btn primary">Create a watchlist</Link>}>Follow anything: stocks, ETFs, crypto, indexes.</Empty>}
        </div>
        {me?.preferences?.dailyBrief === false ? <div className="card"><Empty title="Market Brief is hidden" action={<Link to="/app/notifications" className="btn sm">Turn it back on</Link>} /></div> : <Brief data={brief.data?.data} loading={brief.loading} error={brief.error} />}
      </div>
      <div className="grid-2">
        <div className="card flush">
          <div className="card-head"><h2>Markets</h2><DataBadge meta={ov.data?.data.meta} /></div>
          <table className="t responsive"><tbody>{(ov.data?.data.benchmarks ?? []).map((q: any) => <tr key={q.instrumentId} className="clickable" onClick={() => navigate(`/assets/${q.instrumentId}`)}><td><Link to={`/assets/${q.instrumentId}`}>{symbolOf(q.instrumentId)}</Link> <span className="faint">{SESSION_LABEL[q.session]}</span></td><td className="r num">{priceFmt(q.price)}</td><td className="r"><Change pct={q.changePct} /></td></tr>)}</tbody></table>
        </div>
        <div className="card flush">
          <div className="card-head"><h2>Biggest moves today</h2><span className="faint">Across Markets' coverage</span></div>
          <table className="t responsive"><tbody>{[...(ov.data?.data.gainers ?? []).slice(0, 3), ...(ov.data?.data.decliners ?? []).slice(0, 3)].map((q: any) => <tr key={q.instrumentId}><td><Link to={`/assets/${q.instrumentId}`}>{symbolOf(q.instrumentId)}</Link></td><td className="r num">{priceFmt(q.price)} <span className="faint">{q.currency}</span></td><td className="r"><Change pct={q.changePct} /></td></tr>)}</tbody></table>
        </div>
      </div>
    </>
  );
}
function PortfolioHero({ pid, d }: { pid: string; d: any }) {
  const s = d.summary;
  const [range, setRange] = useState<'1M' | '6M' | '1Y' | 'All'>('6M');
  const perf = useApi<{ data: any }>(`/portfolios/${pid}/performance`, [pid]);
  const series = perf.data?.data.series ?? [];
  const days = { '1M': 31, '6M': 183, '1Y': 366, All: 99999 }[range];
  const cut = series.length ? new Date(Date.parse(series[series.length - 1].date) - days * 86400000).toISOString().slice(0, 10) : '';
  const pts = series.filter((x: any) => x.date >= cut).map((x: any) => ({ date: x.date, value: Number(x.value) }));
  return (
    <section className="hero-card">
      <div className="hero-top">
        <div className="stack-sm" style={{ gap: 6 }}>
          <span className="row wrap faint">{d.portfolio.name}{d.portfolio.kind === 'demo' && <span className="badge demo">Demo portfolio</span>}</span>
          <span className="hero-value num">{money(s.totalValue, s.baseCurrency)}</span>
          <span className="row wrap" style={{ gap: 14 }}>
            {d.today && <span><Change abs={d.today.change} pct={d.today.changePct} currency={s.baseCurrency} /> <span className="faint">today</span></span>}
            {s.unrealizedGain && <span><Change abs={s.unrealizedGain} currency={s.baseCurrency} /> <span className="faint">unrealized</span></span>}
          </span>
        </div>
        <div className="stack-sm" style={{ justifyItems: 'end' }}>
          <Seg label="Chart range" value={range} onChange={setRange} options={(['1M', '6M', '1Y', 'All'] as const).map(r => ({ value: r, label: r }))} />
          <Link to="/app/portfolio" className="btn sm ghost">Open portfolio</Link>
        </div>
      </div>
      {pts.length > 1 ? <LineChart points={pts} height={190} label={`${d.portfolio.name} value in ${s.baseCurrency}`} format={v => money(v)} /> : <div className="skeleton" style={{ height: 160 }} />}
      <div className="hero-stats">
        <div className="stat"><span className="label">Investment gain</span><span className="value">{s.investmentGain ? <Change abs={s.investmentGain} currency={s.baseCurrency} size={17} /> : <span className="faint small">Record deposits to see this</span>}</span></div>
        <div className="stat"><span className="label">Contributions</span><span className="value num">{s.contributionsRecorded ? money(s.netContributions, s.baseCurrency) : '—'}</span></div>
        <div className="stat"><span className="label">Cash</span><span className="value num">{s.cash != null ? money(s.cash, s.baseCurrency) : '—'}</span></div>
        <div className="stat"><span className="label">Income received</span><span className="value num">{money(s.income, s.baseCurrency)}</span></div>
      </div>
      <p className="faint">The chart shows value including contributions; see Performance for returns that remove them.</p>
    </section>
  );
}

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

function Brief({ data, loading, error }: { data: any; loading: boolean; error: any }) {
  return (
    <div className="card">
      <div className="card-head"><h2>Your Market Brief</h2>{data && <span className="faint">{timeAgo(data.generatedAt)}</span>}</div>
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} /> : data && (
        <div className="stack-sm">
          {data.alerts.map((a: any) => <Link key={a.id} to="/app/notifications" className="notice green" style={{ textDecoration: 'none' }}><Icon name="bell" /><span>{a.message} <span className="faint">{timeAgo(a.observedAt)}</span></span></Link>)}
          {data.moves.map((m: any) => <div key={m.instrumentId} className="row between small"><Link to={`/assets/${m.instrumentId}`}>{symbolOf(m.instrumentId)} moved</Link><span><Change pct={m.changePct} /> <span className="faint">{timeAgo(m.observedAt)}</span></span></div>)}
          {data.upcoming.slice(0, 4).map((e: any) => <div key={e.id} className="row between small"><span>{e.title}</span><span className="faint">{dateFmt(e.date)}{!e.confirmed && ' (estimated)'}</span></div>)}
          {!data.alerts.length && !data.moves.length && !data.upcoming.length && <p className="muted small">Nothing notable in what you follow right now.</p>}
          {data.provenance === 'demo' && <p className="faint">Based on demo data.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------- Watchlists ----------------
type SortKey = 'symbol' | 'change' | 'price' | 'added';
export function Watchlists() {
  const { data, loading, error, reload } = useApi<{ data: any[] }>('/watchlists');
  const toast = useToast();
  const [active, setActive] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'new' | 'rename' | 'add' | 'rule'>(null);
  const [name, setName] = useState('');
  const [sort, setSort] = useState<SortKey>('added');
  const [filter, setFilter] = useState('');
  const lists = data?.data ?? [];
  const list = lists.find(l => l.id === active) ?? lists[0];
  const rows = useMemo(() => {
    const r = (list?.items ?? []).filter((i: any) => !filter || i.instrument?.assetClass === filter);
    const by: Record<SortKey, (a: any, b: any) => number> = { symbol: (a, b) => a.instrument.symbol.localeCompare(b.instrument.symbol), change: (a, b) => Number(b.quote?.changePct ?? -999) - Number(a.quote?.changePct ?? -999), price: (a, b) => Number(b.quote?.price) - Number(a.quote?.price), added: () => 0 };
    return [...r].sort(by[sort]);
  }, [list, sort, filter]);
  const run = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); await reload(); } catch (e: any) { toast(e.message, 'err'); } };
  const move = (dir: -1 | 1) => { const ids = lists.map(l => l.id); const i = ids.indexOf(list.id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; void run(() => api.post('/watchlists/reorder', { ids }), 'Order saved.'); };
  return (
    <>
      <div className="page-head"><div><h1>Watchlists</h1><p>{isDesktopApp() ? 'Follow anything in Markets\' coverage. Saved on this computer.' : 'Follow anything in Markets\' coverage. Saved to your account, on every device.'}</p></div><button className="btn primary" onClick={() => { setName(''); setDialog('new'); }}><Icon name="plus" />New watchlist</button></div>
      <ErrorState error={error} retry={reload} />
      {loading && !data ? <div className="card"><Loading rows={5} /></div> : !lists.length ? (
        <div className="card"><Empty title="Create your first watchlist" action={<button className="btn primary" onClick={() => { setName('My watchlist'); setDialog('new'); }}>Create a watchlist</button>}>Watchlists don't need any holdings or a bank connection.</Empty></div>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Watchlists">{lists.map(l => <button key={l.id} role="tab" aria-selected={l.id === list.id} onClick={() => setActive(l.id)}>{l.name} <span className="faint">{l.items.length}</span></button>)}</div>
          <div className="row wrap between">
            <div className="row wrap">
              <button className="btn sm primary" onClick={() => setDialog('add')}><Icon name="plus" size={15} />Add</button>
              <button className="btn sm" onClick={() => setDialog('rule')}><Icon name="dip" size={15} />Dip rule for this list</button>
              <button className="btn sm ghost" onClick={() => { setName(list.name); setDialog('rename'); }}><Icon name="edit" size={15} />Rename</button>
              <button className="btn sm ghost" onClick={() => move(-1)} aria-label="Move this list earlier">←</button><button className="btn sm ghost" onClick={() => move(1)} aria-label="Move this list later">→</button>
              <button className="btn sm ghost danger" onClick={() => { if (confirm(`Delete "${list.name}"? Its instruments aren't affected.`)) void run(() => api.del(`/watchlists/${list.id}`), 'Watchlist deleted.'); }}><Icon name="trash" size={15} />Delete</button>
            </div>
            <div className="row wrap">
              <select className="input" style={{ width: 'auto', minHeight: 34 }} value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter by asset class"><option value="">All types</option>{Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select className="input" style={{ width: 'auto', minHeight: 34 }} value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Sort"><option value="added">Order added</option><option value="change">Today's change</option><option value="symbol">Symbol</option><option value="price">Price</option></select>
            </div>
          </div>
          <div className="card flush">
            {!rows.length ? <Empty title="This list is empty" action={<button className="btn primary" onClick={() => setDialog('add')}>Add an instrument</button>} /> : (
              <table className="t responsive">
                <thead><tr><th>Asset</th><th className="hide-m">30 days</th><th className="r">Price</th><th className="r">Today</th><th className="r hide-m">Status</th><th /></tr></thead>
                <tbody>{rows.map((i: any) => (
                  <tr key={i.instrumentId}>
                    <td><AssetCell inst={i.instrument} /></td>
                    <td className="hide-m"><Spark values={i.sparkline} /></td>
                    <td className="r">{i.quote?.locked ? <LockedPrice reason={i.quote.lockReason} /> : i.quote ? <Price value={i.quote.price} currency={i.quote.currency} /> : <span className="faint">Unavailable</span>}</td>
                    <td className="r">{!i.quote?.locked && <Change pct={i.quote?.changePct} />}</td>
                    <td className="r hide-m faint">{i.quote && !i.quote.locked ? `${SESSION_LABEL[i.quote.session]} · ${timeAgo(i.quote.meta.observedAt)}` : '—'}</td>
                    <td className="r"><button className="icon-btn" aria-label={`Remove ${i.instrument?.symbol}`} onClick={() => void run(() => api.del(`/watchlists/${list.id}/items/${i.instrumentId}`), 'Removed.')}><Icon name="close" size={16} /></button></td>
                  </tr>))}</tbody>
              </table>
            )}
          </div>
          {list.items[0]?.quote?.meta?.provenance === 'demo' && <p className="faint">Prices are demo data.</p>}
        </>
      )}
      {(dialog === 'new' || dialog === 'rename') && <Dialog title={dialog === 'new' ? 'New watchlist' : 'Rename watchlist'} onClose={() => setDialog(null)} footer={<><button className="btn ghost" onClick={() => setDialog(null)}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={() => { setDialog(null); void run(async () => { if (dialog === 'new') { const r = await api.post('/watchlists', { name }); setActive(r.data.id); } else await api.patch(`/watchlists/${list.id}`, { name }); }, dialog === 'new' ? 'Watchlist created.' : 'Renamed.'); }}>Save</button></>}>
        <label className="field">Name<input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={60} /></label>
      </Dialog>}
      {dialog === 'add' && list && <AddAssets list={list} onClose={() => setDialog(null)} onChanged={() => void reload()} />}
      {dialog === 'rule' && list && <RuleDialog initial={{ scope: 'watchlist', watchlistId: list.id }} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); toast('Rule saved. Dip Radar checks it every 30 minutes.'); }} />}
    </>
  );
}

// ---------------- Asset research ----------------
const RANGES = ['1M', '3M', '6M', 'YTD', '1Y', '5Y'] as const;
export function Asset({ id, signedIn }: { id: string; signedIn: boolean }) {
  const toast = useToast();
  const inst = useApi<{ data: any }>(`/assets/${id}`, [id]);
  const quote = useApi<{ data: any }>(`/assets/${id}/quote`, [id]);
  const [range, setRange] = useState<(typeof RANGES)[number]>('1Y');
  const hist = useApi<{ data: any[]; meta: any }>(`/assets/${id}/history?range=${range}`, [id, range]);
  const [priceMode, setPriceMode] = useState<'raw' | 'adjusted'>('raw');
  const stats = useApi<{ data: any }>(`/assets/${id}/statistics`, [id]);
  const events = useApi<{ data: any[] }>(`/assets/${id}/events`, [id]);
  const divs = useApi<{ data: any[] }>(`/assets/${id}/dividends`, [id]);
  const news = useApi<{ data: any[] }>(`/assets/${id}/news?limit=6`, [id]);
  const related = useApi<{ data: any }>(`/assets/${id}/related`, [id]);
  const lists = useApi<{ data: any[] }>(signedIn ? '/watchlists' : null);
  const [tab, setTab] = useState<'overview' | 'financials' | 'dividends' | 'news' | 'community'>('overview');
  const [dialog, setDialog] = useState<null | 'rule' | 'watch'>(null);
  const i = inst.data?.data, q = quote.data?.data, st = stats.data?.data;
  const dip = useApi<{ data: any }>(`/assets/${id}/dip?windowDays=30`, [id]);
  const snap = dip.data?.data;
  if (inst.error) return <ErrorState error={inst.error} />;
  if (!i) return <div className="card"><Loading rows={6} /></div>;
  const lockErr = (quote.error as any)?.code === 'locked' ? quote.error as any : null;
  if (lockErr) return (
    <>
      <div className="page-head">
        <div className="stack-sm">
          <div className="row wrap"><ClassLabel c={i.assetClass} /><span className="faint">{i.symbol} · {i.exchangeName} · {i.currency}</span></div>
          <h1>{i.name}</h1>
          <LockedPrice reason={lockErr.details?.reason} size="lg" />
          <OtherListings ids={i.otherListings} prominent />
        </div>
      </div>
      <LockedPanel reason={lockErr.details?.reason} symbol={i.symbol} />
    </>
  );
  const equity = i.assetClass === 'stock', fund = i.assetClass === 'etf' || i.assetClass === 'mutual_fund';
  const points = (hist.data?.data ?? []).map(b => ({ date: b.date, value: Number(priceMode === 'raw' ? b.close : b.adjClose) }));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="page-head">
        <div className="stack-sm">
          <div className="row wrap"><ClassLabel c={i.assetClass} /><span className="faint">{i.symbol} · {i.exchangeName} · {i.currency}</span>{!i.tradable && <span className="chip warn">Not directly purchasable</span>}</div>
          <h1>{i.name}</h1>
          <OtherListings ids={i.otherListings} />
          {q ? <div className="row wrap" style={{ alignItems: 'baseline' }}><span className="num" style={{ fontSize: 32, fontWeight: 750, letterSpacing: '-0.02em' }}>{priceFmt(q.price)}</span><span className="faint">{q.currency}</span><Change abs={q.change} pct={q.changePct} size={16} /><span className="faint">today</span></div> : <Loading rows={1} />}
          {q && <div className="row wrap"><span className="chip">{SESSION_LABEL[q.session]}</span><DataBadge meta={q.meta} /></div>}
        </div>
        <div className="row wrap">
          {signedIn ? <>
            <button className="btn" onClick={() => setDialog('watch')}><Icon name="watchlists" size={16} />Watch</button>
            {i.tradable && <button className="btn" onClick={() => setDialog('rule')}><Icon name="dip" size={16} />Set a dip rule</button>}
            {i.tradable && <Link to={`/app/what-if?instrument=${id}`} className="btn primary"><Icon name="whatif" size={16} />What if I bought it?</Link>}
          </> : <Link to="/" className="btn primary">Get the app</Link>}
        </div>
      </div>
      {snap && snap.dropPct && Number(snap.dropPct) < 0 && <div className="notice"><Icon name="dip" /><span>{signedPct(snap.dropPct)} from its 30-day closing high of {priceFmt(snap.reference)} ({dateFmt(snap.referenceDate)}). The daily change is shown separately above. {signedIn && <Link to={`/app/dip-radar?context=${id}`}>See what accompanies this</Link>}</span></div>}
      <div className="card">
        <div className="row wrap between" style={{ marginBottom: 12 }}>
          <Seg label="Chart range" value={range} onChange={setRange} options={RANGES.map(r => ({ value: r, label: r }))} />
          <Seg label="Price basis" value={priceMode} onChange={setPriceMode} options={[{ value: 'raw', label: 'Price' }, { value: 'adjusted', label: 'Total return' }]} />
        </div>
        {hist.loading && !hist.data ? <div className="skeleton" style={{ height: 240 }} /> : hist.error ? <ErrorState error={hist.error} retry={hist.reload} /> :
          <LineChart points={points} label={`${i.symbol} ${priceMode === 'raw' ? 'closing price' : 'adjusted close (total return)'}, ${range}`} refLine={snap && range === '1M' ? { value: Number(snap.reference), label: '30D high' } : null} />}
        <p className="faint" style={{ marginTop: 8 }}>{priceMode === 'raw' ? 'Daily closing prices as traded. Splits show as jumps.' : 'Adjusted closes include splits and reinvested distributions, so they show total return.'} Completed sessions only.</p>
      </div>
      <div className="tabs" role="tablist" aria-label="Asset sections">{(['overview', ...(equity ? ['financials'] : []), ...(equity || fund ? ['dividends'] : []), 'news', 'community'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t as any)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      {tab === 'overview' && <div className="grid-2">
        <div className="card"><h2 style={{ marginBottom: 12 }}>Key statistics</h2>{st ? <dl className="kv">
          <dt>52-week range</dt><dd>{priceFmt(st.fiftyTwoWeekLow)} – {priceFmt(st.fiftyTwoWeekHigh)}</dd>
          <dt>Volatility (1 year)</dt><dd>{st.volatility1y ? `${st.volatility1y}%` : '—'}</dd>
          <dt>Largest drop (1 year)</dt><dd>{st.maxDrawdown1y ? `${st.maxDrawdown1y}%` : '—'}</dd>
          {equity && <><dt>Market cap</dt><dd>{money(st.marketCap, i.currency, { compact: true })}</dd><dt>P/E ratio</dt><dd>{st.peRatio ?? '—'}</dd><dt>Beta</dt><dd>{st.beta ?? '—'}</dd></>}
          {(equity || fund) && <><dt>Dividend yield</dt><dd>{st.dividendYield != null ? `${st.dividendYield}%` : '—'}</dd></>}
          {fund && <><dt>Expense ratio</dt><dd>{st.expenseRatio ? `${st.expenseRatio}%` : '—'}</dd></>}
        </dl> : <Loading />}<p className="muted small" style={{ marginTop: 12 }}>{i.description}</p></div>
        <div className="card"><h2 style={{ marginBottom: 12 }}>Upcoming</h2>{(events.data?.data ?? []).filter(e => e.date >= today).slice(0, 6).map(e => <div key={e.id} className="row between small" style={{ padding: '6px 0' }}><span>{e.title}</span><span className={e.confirmed ? '' : 'faint'}>{dateFmt(e.date)}{!e.confirmed && ' · estimated'}</span></div>)}{events.data && !events.data.data.some(e => e.date >= today) && <p className="muted small">No upcoming events.</p>}</div>
        <div className="card span-2"><h2 style={{ marginBottom: 6 }}>Similar & different</h2><p className="faint" style={{ marginBottom: 12 }}>{related.data?.data.disclaimer}</p>
          {related.data ? <div className="grid-2">{(['similar', 'different'] as const).map(k => <div key={k} className="stack-sm"><h3>{k === 'similar' ? 'Similar exposure' : 'Different exposure'}</h3>{related.data!.data[k].map((r: any) => <div key={r.instrumentId} className="row between" style={{ alignItems: 'flex-start' }}><Link to={`/assets/${r.instrumentId}`}><b>{symbolOf(r.instrumentId)}</b></Link><span className="faint" style={{ textAlign: 'right' }}>{r.reasons.slice(0, 2).join(' · ')}</span></div>)}{!related.data!.data[k].length && <p className="faint">Nothing stood out.</p>}</div>)}</div> : <Loading />}
          <p className="faint" style={{ marginTop: 10 }}>{related.data?.data.method}</p></div>
      </div>}
      {tab === 'financials' && <Financials id={id} />}
      {tab === 'dividends' && <div className="card flush"><div className="card-head"><h2>Dividends</h2><span className="faint">Per unit, {i.currency}</span></div>
        {divs.data?.data.length ? <table className="t responsive"><thead><tr><th>Ex-date</th><th>Paid</th><th className="r">Amount</th><th className="r">Status</th></tr></thead><tbody>{[...divs.data.data].reverse().slice(0, 16).map(d => <tr key={d.exDate}><td>{dateFmt(d.exDate)}</td><td>{dateFmt(d.payDate)}</td><td className="r num">{priceFmt(d.amount)}</td><td className="r"><span className={`chip ${d.status === 'projected' ? 'warn' : d.status === 'declared' ? 'green' : ''}`}>{d.status === 'projected' ? 'Projected (estimate)' : d.status === 'declared' ? 'Declared' : 'Paid'}</span></td></tr>)}</tbody></table> : <Empty title="No dividends">This instrument hasn't paid distributions in the data available.</Empty>}</div>}
      {tab === 'news' && <div className="card stack-sm"><h2>News</h2>{(news.data?.data ?? []).map(n => <article key={n.id} className="stack-sm" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}><div className="row wrap"><span className="chip">{n.kind === 'opinion' ? 'Opinion' : n.kind === 'reporting' ? 'Reporting' : 'News'}</span>{n.provenance === 'demo' && <span className="badge demo">Demo headline</span>}<span className="faint">{n.publisher} · {timeAgo(n.publishedAt)}</span></div><h3>{n.url.startsWith('http') ? <a href={n.url} target="_blank" rel="noreferrer">{n.title} <Icon name="external" size={13} /></a> : n.title}</h3>{n.excerpt && <p className="muted small">{n.excerpt}</p>}</article>)}{news.data && !news.data.data.length && <p className="muted">No recent news.</p>}</div>}
      {tab === 'community' && <AssetCommunity id={id} signedIn={signedIn} />}
      {dialog === 'rule' && <RuleDialog initial={{ scope: 'instrument', instrumentId: id }} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); toast('Rule saved. Dip Radar checks it every 30 minutes.'); }} />}
      {dialog === 'watch' && <Dialog title={`Add ${i.symbol} to a watchlist`} onClose={() => setDialog(null)}>
        {(lists.data?.data ?? []).map(l => { const has = l.items.some((x: any) => x.instrumentId === id); return <button key={l.id} className="btn" disabled={has} onClick={async () => { try { await api.post(`/watchlists/${l.id}/items`, { instrumentId: id }); toast(`Added to ${l.name}.`); setDialog(null); void lists.reload(); } catch (e: any) { toast(e.message, 'err'); } }}>{has ? `Already in ${l.name}` : `Add to ${l.name}`}</button>; })}
        <button className="btn primary" onClick={async () => { try { await api.post('/watchlists', { name: 'My watchlist', instrumentIds: [id] }); toast('Added to a new watchlist.'); setDialog(null); void lists.reload(); } catch (e: any) { toast(e.message, 'err'); } }}><Icon name="plus" size={15} />New watchlist with {i.symbol}</button>
      </Dialog>}
    </>
  );
}

function Financials({ id }: { id: string }) {
  const { data } = useApi<{ data: any }>(`/assets/${id}/financials`, [id]);
  const f = data?.data;
  if (!data) return <div className="card"><Loading /></div>;
  if (!f) return <div className="card"><Empty title="No financial statements">Statements apply to companies only.</Empty></div>;
  const block = (title: string, rows: any[]) => <div className="card flush"><div className="card-head"><h2>{title}</h2><span className="faint">{f.currency}</span></div><div className="scroll-x"><table className="t"><thead><tr><th />{f.periods.map((p: string) => <th key={p} className="r">{p}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.label}><td>{r.label}</td>{r.values.map((v: string | null, k: number) => <td key={k} className="r num">{money(v, undefined, { compact: true })}</td>)}</tr>)}</tbody></table></div></div>;
  return <div className="stack">{f.meta.provenance === 'demo' && <div className="notice warn"><Icon name="info" />Demo financial statements. Not real company results.</div>}{block('Income statement', f.income)}{block('Balance sheet', f.balance)}{block('Cash flow', f.cashflow)}</div>;
}

function AssetCommunity({ id, signedIn }: { id: string; signedIn: boolean }) {
  const { data } = useApi<{ data: any[]; posting: any }>(signedIn ? `/community/posts?instrumentId=${id}` : null, [id]);
  if (!signedIn) return <div className="card"><Empty title="Discussions" action={<Link to="/signup" className="btn primary">Sign up</Link>}>Sign in to read discussions about this asset.</Empty></div>;
  return <div className="stack">{data?.posting && <div className="notice"><Icon name="info" />{data.posting.reason}</div>}{(data?.data ?? []).map(p => <PostCard key={p.id} p={p} />)}{data && !data.data.length && <div className="card"><Empty title="No discussions about this asset yet" /></div>}</div>;
}

export function PostCard({ p, onBookmark }: { p: any; onBookmark?: () => void }) {
  return (
    <article className="card stack-sm">
      <div className="row wrap between"><div className="row"><span className="avatar" aria-hidden>{p.author.name.slice(-1)}</span><div><b>{p.author.name}</b> <span className="faint">@{p.author.handle} · {timeAgo(p.createdAt)}</span></div></div><div className="row"><span className="badge demo">Sample discussion</span>{onBookmark && <button className="btn sm ghost" onClick={onBookmark} aria-pressed={p.bookmarked}>{p.bookmarked ? 'Saved' : 'Save'}</button>}</div></div>
      {p.thesis ? <dl className="stack-sm" style={{ margin: 0 }}>{(['idea', 'reasoning', 'risks', 'horizon'] as const).map(k => <div key={k}><dt className="faint" style={{ textTransform: 'capitalize' }}>{k}</dt><dd style={{ margin: 0 }}>{p.thesis[k]}</dd></div>)}</dl> : <p>{p.body}</p>}
      <div className="row wrap">{p.instrumentIds.map((x: string) => <Link key={x} to={`/assets/${x}`} className="chip">{symbolOf(x)}</Link>)}<span className="faint">{p.comments} comments</span></div>
    </article>
  );
}
