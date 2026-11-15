import { useEffect, useMemo, useState } from 'react';
import { api, useApi } from '../lib/api';
import { Link, navigate, useLocation } from '../lib/router';
import { dateFmt, money, priceFmt, signedPct, timeAgo } from '../lib/format';
import { useMe } from '../components/Shell';
import { InstrumentPicker } from '../components/InstrumentPicker';
import { AssetCell, Change, DataBadge, Dialog, Empty, ErrorState, Icon, Loading, Meter, Price, Seg, useToast } from '../components/ui';

export const KIND_LABEL: Record<string, string> = {
  below_rolling_high: 'Below its rolling high', below_52w_high: 'Below its 52-week high', target_price: 'At or below a target price',
  below_avg_cost: 'Below my average cost', daily_drop: 'Falls in one day', weekly_drop: 'Falls over a week',
};

// ---------------- Rule editor ----------------
export function RuleDialog({ initial = {}, ruleId, onClose, onSaved }: { initial?: any; ruleId?: string; onClose: () => void; onSaved: () => void }) {
  const lists = useApi<{ data: any[] }>('/watchlists');
  const pfs = useApi<{ data: any[] }>('/portfolios');
  const [r, set] = useState<any>({ name: '', scope: 'instrument', kind: 'below_rolling_high', threshold: '8', windowDays: 30, basis: 'close', resetBand: '2', cooldownHours: 24, notify: true, active: true, ...initial });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const pctKind = r.kind !== 'target_price';
  const kinds = r.scope === 'instrument' ? ['below_rolling_high', 'below_52w_high', 'target_price', 'daily_drop', 'weekly_drop'] : r.scope === 'holdings' ? ['below_rolling_high', 'below_52w_high', 'below_avg_cost', 'daily_drop', 'weekly_drop'] : ['below_rolling_high', 'below_52w_high', 'daily_drop', 'weekly_drop'];
  useEffect(() => { if (!kinds.includes(r.kind)) set((x: any) => ({ ...x, kind: kinds[0] })); }, [r.scope]); // eslint-disable-line
  const save = async () => {
    setBusy(true); setErr('');
    try { if (ruleId) await api.patch(`/alerts/rules/${ruleId}`, r); else await api.post('/alerts/rules', r); onSaved(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const explain = r.kind === 'target_price' ? `Alerts when the price is at or below ${r.threshold || '…'}.`
    : r.kind === 'below_avg_cost' ? `Alerts when the price is ${r.threshold}% or more below your average cost.`
    : r.kind === 'daily_drop' ? `Alerts when the price is ${r.threshold}% or more below the previous close.`
    : r.kind === 'weekly_drop' ? `Alerts when the price is ${r.threshold}% or more below the close five trading days ago.`
    : `Alerts when the price is ${r.threshold}% or more below the highest ${r.basis === 'close' ? 'adjusted close' : 'intraday high'} of the last ${r.kind === 'below_52w_high' ? 365 : r.windowDays} days.`;
  return (
    <Dialog title={ruleId ? 'Edit rule' : 'New Dip Radar rule'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save rule'}</button></>}>
      <label className="field">What it watches<select className="input" value={r.scope} onChange={e => set({ ...r, scope: e.target.value })}><option value="instrument">One instrument</option><option value="watchlist">Everything in a watchlist</option><option value="holdings">My holdings in a portfolio</option></select></label>
      {r.scope === 'instrument' && <InstrumentPicker value={r.instrumentId ?? null} tradableOnly onChange={id => set({ ...r, instrumentId: id })} />}
      {r.scope === 'watchlist' && <label className="field">Watchlist<select className="input" value={r.watchlistId ?? ''} onChange={e => set({ ...r, watchlistId: e.target.value })}><option value="">Choose…</option>{lists.data?.data.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
      {r.scope === 'holdings' && <label className="field">Portfolio<select className="input" value={r.portfolioId ?? ''} onChange={e => set({ ...r, portfolioId: e.target.value })}><option value="">Choose…</option>{pfs.data?.data.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <label className="field">Condition<select className="input" value={r.kind} onChange={e => set({ ...r, kind: e.target.value })}>{kinds.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
      <div className="grid-2">
        <label className="field">{pctKind ? 'Threshold (%)' : 'Target price'}<input className="input" inputMode="decimal" value={r.threshold} onChange={e => set({ ...r, threshold: e.target.value })} /></label>
        {r.kind === 'below_rolling_high' && <label className="field">Window (days)<input className="input" type="number" min={5} max={365} value={r.windowDays} onChange={e => set({ ...r, windowDays: Number(e.target.value) })} /></label>}
      </div>
      {(r.kind === 'below_rolling_high' || r.kind === 'below_52w_high') && <div className="stack-sm"><span className="small muted">The high is the</span><Seg label="High basis" value={r.basis} onChange={v => set({ ...r, basis: v })} options={[{ value: 'close', label: 'Highest close' }, { value: 'intraday', label: 'Highest intraday high' }]} /></div>}
      <div className="grid-2">
        <label className="field">Reset after recovering (points)<input className="input" inputMode="decimal" value={r.resetBand} onChange={e => set({ ...r, resetBand: e.target.value })} /></label>
        <label className="field">Wait between alerts (hours)<input className="input" type="number" min={1} max={720} value={r.cooldownHours} onChange={e => set({ ...r, cooldownHours: Number(e.target.value) })} /></label>
      </div>
      <label className="field">Name (optional)<input className="input" value={r.name} maxLength={80} onChange={e => set({ ...r, name: e.target.value })} /></label>
      <div className="notice green"><Icon name="info" /><span>{explain} After it alerts, it waits until the price recovers {r.resetBand} percentage points past the threshold before it can alert again, and never more than once every {r.cooldownHours} hours. Prices are adjusted for splits, so a split never looks like a dip.</span></div>
      {err && <p className="notice warn" role="alert">{err}</p>}
    </Dialog>
  );
}

// ---------------- Dip Context ----------------
function ContextPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useApi<{ data: any }>(`/context/${id}`, [id]);
  const d = data?.data; const o = d?.observations;
  return (
    <Dialog title="Dip Context" onClose={onClose} wide>
      {error && <ErrorState error={error} />}
      {!d ? <Loading rows={6} /> : <>
        <div className="row wrap"><b style={{ fontSize: 18 }}>{id.split('.')[1].toUpperCase()}</b>{d.provenance === 'demo' && <span className="badge demo">Demo data</span>}</div>
        <div className="grid-3">
          <div className="stat"><span className="label">From 30-day high</span><span className="value"><Change pct={o.drop.from30dHigh} size={20} /></span></div>
          <div className="stat"><span className="label">From 52-week high</span><span className="value"><Change pct={o.drop.from52wHigh} size={20} /></span></div>
          <div className="stat"><span className="label">Today</span><span className="value"><Change pct={o.drop.dailyChangePct} size={20} /></span></div>
        </div>
        <h3>Observations</h3>
        <div className="scroll-x"><table className="t"><thead><tr><th>Performance</th><th className="r">30 days</th><th className="r">90 days</th><th className="r">1 year</th></tr></thead><tbody>
          <tr><td><b>{id.split('.')[1].toUpperCase()}</b></td><td className="r"><Change pct={o.performance.instrument.d30} /></td><td className="r"><Change pct={o.performance.instrument.d90} /></td><td className="r"><Change pct={o.performance.instrument.y1} /></td></tr>
          {o.performance.benchmark && <tr><td>Benchmark ({o.performance.benchmark.instrumentId.split('.')[1].toUpperCase()})</td><td className="r"><Change pct={o.performance.benchmark.d30} /></td><td className="r"><Change pct={o.performance.benchmark.d90} /></td><td className="r"><Change pct={o.performance.benchmark.y1} /></td></tr>}
          {o.performance.sectorPeers.slice(0, 4).map((p: any) => <tr key={p.instrumentId}><td className="muted">Sector peer {p.instrumentId.split('.')[1].toUpperCase()}</td><td className="r"><Change pct={p.d30} /></td><td className="r"><Change pct={p.d90} /></td><td className="r"><Change pct={p.y1} /></td></tr>)}
        </tbody></table></div>
        <p className="faint">{o.performance.note}</p>
        <dl className="kv"><dt>Volatility (1 year)</dt><dd>{o.volatility1y ? `${o.volatility1y}%` : '—'}</dd><dt>Largest drop in the last year</dt><dd>{o.maxDrawdown1y ? `${o.maxDrawdown1y}%` : '—'}</dd></dl>
        {o.recentEvents.length > 0 && <div className="stack-sm"><h3>Recent events</h3>{o.recentEvents.map((e: any) => <div key={e.id} className="row between small"><span>{e.title}</span><span className="faint">{dateFmt(e.date)}</span></div>)}</div>}
        {o.upcomingEvents.length > 0 && <div className="stack-sm"><h3>Coming up</h3>{o.upcomingEvents.map((e: any) => <div key={e.id} className="row between small"><span>{e.title}</span><span className="faint">{dateFmt(e.date)}{!e.confirmed && ' · estimated'}</span></div>)}</div>}
        <div className="stack-sm"><h3>News around the same time</h3>{o.news.map((n: any) => <div key={n.id} className="small"><b>{n.title}</b> <span className="faint">{n.publisher} · {timeAgo(n.publishedAt)}</span>{n.provenance === 'demo' && <span className="badge demo" style={{ marginLeft: 6 }}>Demo</span>}</div>)}</div>
        <div className="stack-sm"><h3>Your exposure</h3>{o.portfolioExposure.length ? o.portfolioExposure.map((e: any) => <div key={e.portfolioId} className="row between small"><span>{e.portfolio}</span><span className="num">{e.totalPct}% of the portfolio (direct and through funds)</span></div>) : <p className="muted small">You don't hold it, directly or through funds.</p>}</div>
        <div className="notice warn"><Icon name="info" /><span>{d.unknown} {d.reminder}</span></div>
      </>}
    </Dialog>
  );
}

// ---------------- Dip Radar ----------------
export function DipRadar() {
  const { search } = useLocation();
  const toast = useToast();
  const [windowDays, setWindow] = useState(30);
  const [basis, setBasis] = useState<'close' | 'intraday'>('close');
  const [sort, setSort] = useState<'drop' | 'daily' | 'symbol' | 'exposure'>('drop');
  const [onlyMatches, setOnly] = useState(false);
  const radar = useApi<{ data: any[]; definition: string; reminder: string }>(`/dip-radar?windowDays=${windowDays}&basis=${basis}`, [windowDays, basis]);
  const rules = useApi<{ data: any[] }>('/alerts/rules');
  const [ctx, setCtx] = useState<string | null>(search.get('context'));
  const [edit, setEdit] = useState<null | { id?: string; initial?: any }>(null);
  const rows = useMemo(() => {
    const r = (radar.data?.data ?? []).filter(x => !onlyMatches || x.matchedRules.length);
    const exp = (x: any) => Math.max(0, ...x.exposure.map((e: any) => Number(e.weightPct ?? 0)));
    const s: Record<string, (a: any, b: any) => number> = { drop: (a, b) => Number(a.dropPct ?? 0) - Number(b.dropPct ?? 0), daily: (a, b) => Number(a.quote.changePct) - Number(b.quote.changePct), symbol: (a, b) => a.instrument.symbol.localeCompare(b.instrument.symbol), exposure: (a, b) => exp(b) - exp(a) };
    return [...r].sort(s[sort]);
  }, [radar.data, sort, onlyMatches]);
  const evaluate = async () => { try { const r = await api.post('/alerts/evaluate'); toast(r.data.fired ? `${r.data.fired} new alert${r.data.fired > 1 ? 's' : ''}.` : 'Checked. No new alerts.'); } catch (e: any) { toast(e.message, 'err'); } };
  return (
    <>
      <div className="page-head"><div><h1>Dip Radar</h1><p>The pullback. The context. Your plan.</p></div><div className="row wrap"><button className="btn" onClick={evaluate}>Check my rules now</button><button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" />New rule</button></div></div>
      <div className="row wrap between">
        <div className="row wrap"><span className="small muted">Measure from the highest</span><Seg label="High basis" value={basis} onChange={setBasis} options={[{ value: 'close', label: 'close' }, { value: 'intraday', label: 'intraday high' }]} /><span className="small muted">over</span><Seg label="Window" value={String(windowDays) as any} onChange={v => setWindow(Number(v))} options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '52 weeks' }]} /></div>
        <div className="row wrap"><label className="check"><input type="checkbox" checked={onlyMatches} onChange={e => setOnly(e.target.checked)} />Only my rule matches</label><select className="input" style={{ width: 'auto', minHeight: 34 }} value={sort} onChange={e => setSort(e.target.value as any)} aria-label="Sort by"><option value="drop">Drop from high</option><option value="daily">Today's change</option><option value="exposure">My exposure</option><option value="symbol">Symbol</option></select></div>
      </div>
      <ErrorState error={radar.error} retry={radar.reload} />
      <div className="card flush">
        <div className="card-head"><div><h2>On your radar</h2><p className="faint">{radar.data?.definition}</p></div><DataBadge meta={rows[0]?.quote.meta} /></div>
        {radar.loading && !radar.data ? <div style={{ padding: 18 }}><Loading rows={5} /></div> : !rows.length ? <Empty title={onlyMatches ? 'None of your rules match right now' : 'Nothing to watch yet'} action={<Link to="/app/watchlists" className="btn primary">Add to a watchlist</Link>}>Dip Radar watches your watchlists, your holdings and instruments with rules.</Empty> : (
          <table className="t responsive">
            <thead><tr><th>Asset</th><th className="r">Price</th><th className="r">From high</th><th className="r">Today</th><th className="hide-m">Your rule</th><th className="hide-m">Exposure</th><th /></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.instrumentId} className={r.matchedRules.length ? 'selected' : ''}>
                <td><AssetCell inst={r.instrument} /><div className="faint" style={{ marginTop: 2 }}>{r.sources.join(' · ')}</div>{r.matchedRules.length > 0 && <span className="chip green show-m" style={{ marginTop: 6 }}>Your rule matched</span>}</td>
                <td className="r"><Price value={r.quote.price} currency={r.quote.currency} /><div className="faint">{timeAgo(r.quote.meta.observedAt)}</div></td>
                <td className="r"><Change pct={r.dropPct} /><div className="faint">high {priceFmt(r.reference)}</div></td>
                <td className="r"><Change pct={r.quote.changePct} /></td>
                <td className="hide-m">{r.matchedRules.length ? r.matchedRules.map((m: any) => <span key={m.ruleId} className="chip green">Your rule matched{m.name ? `: ${m.name}` : ''}</span>) : <span className="faint">No match</span>}</td>
                <td className="hide-m">{r.exposure.length ? r.exposure.map((e: any) => <div key={e.portfolioId} className="small">{e.weightPct ?? '—'}% of {e.portfolio}</div>) : <span className="faint">Not held</span>}</td>
                <td className="r"><div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}><button className="btn sm" onClick={() => setCtx(r.instrumentId)}>Context</button><button className="btn sm ghost hide-m" onClick={() => navigate(`/app/plans?new=${r.instrumentId}`)}>Plan</button></div></td>
              </tr>))}</tbody>
          </table>
        )}
        {radar.data && <p className="faint" style={{ padding: '10px 18px 16px' }}>{radar.data.reminder} Sorting by the largest drop doesn't rank anything as a better investment.</p>}
      </div>
      <div className="card flush">
        <div className="card-head"><h2>Your rules</h2></div>
        {!rules.data?.data.length ? <Empty title="No rules yet" action={<button className="btn primary" onClick={() => setEdit({})}>Create a rule</button>}>A rule says what a dip means to you, like "8% below its 30-day high".</Empty> : (
          <table className="t responsive"><tbody>{rules.data.data.map(r => (
            <tr key={r.id}><td><b>{r.name || KIND_LABEL[r.kind]}</b><div className="faint">{KIND_LABEL[r.kind]} · {r.kind === 'target_price' ? priceFmt(r.threshold) : `${r.threshold}%`}{r.kind === 'below_rolling_high' && ` · ${r.windowDays} days`} · {r.scope === 'instrument' ? r.instrumentId?.split('.')[1].toUpperCase() : r.scope === 'watchlist' ? 'a watchlist' : 'holdings'}</div></td>
              <td className="r"><span className={`chip ${r.active ? 'green' : ''}`}>{r.active ? 'On' : 'Paused'}</span></td>
              <td className="r"><button className="btn sm ghost" onClick={() => setEdit({ id: r.id, initial: r })}>Edit</button><button className="btn sm ghost danger" onClick={async () => { if (!confirm('Delete this rule?')) return; await api.del(`/alerts/rules/${r.id}`); void rules.reload(); }}>Delete</button></td></tr>))}</tbody></table>
        )}
      </div>
      {ctx && <ContextPanel id={ctx} onClose={() => setCtx(null)} />}
      {edit && <RuleDialog ruleId={edit.id} initial={edit.initial} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void rules.reload(); void radar.reload(); toast('Rule saved.'); }} />}
    </>
  );
}

// ---------------- Buy Plans ----------------
function PlanDialog({ initial, planId, onClose, onSaved }: { initial: any; planId?: string; onClose: () => void; onSaved: () => void }) {
  const pfs = useApi<{ data: any[] }>('/portfolios');
  const [p, set] = useState<any>({ name: '', mode: 'hybrid', schedule: 'monthly', regularAmount: '250', levels: [{ dropPct: '5', amount: '250' }, { dropPct: '10', amount: '500' }], maxTotal: '', status: 'active', portfolioId: null, ...initial });
  const [err, setErr] = useState(''); const { me } = useMe();
  const levelsTotal = p.levels.reduce((s: number, l: any) => s + Number(l.amount || 0), 0);
  const save = async () => {
    setErr('');
    try { const body = { ...p, maxTotal: p.maxTotal || '0', name: p.name || `${p.instrumentId?.split('.')[1]?.toUpperCase() ?? 'My'} plan`, levels: p.mode === 'regular' ? [] : p.levels }; if (planId) await api.patch(`/plans/${planId}`, body); else await api.post('/plans', body); onSaved(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Dialog title={planId ? 'Edit plan' : 'New Buy Plan'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save plan</button></>}>
      <InstrumentPicker value={p.instrumentId ?? null} tradableOnly onChange={id => set({ ...p, instrumentId: id })} label="What you'd buy" />
      <div className="stack-sm"><span className="small muted">Approach</span><Seg label="Plan type" value={p.mode} onChange={v => set({ ...p, mode: v })} options={[{ value: 'regular', label: 'Regular investing' }, { value: 'dip', label: 'Dip review alerts' }, { value: 'hybrid', label: 'Hybrid' }]} /></div>
      {p.mode !== 'dip' && <div className="grid-2"><label className="field">Regular amount ({me?.baseCurrency ?? 'CAD'})<input className="input" inputMode="decimal" value={p.regularAmount} onChange={e => set({ ...p, regularAmount: e.target.value })} /></label><label className="field">How often<select className="input" value={p.schedule} onChange={e => set({ ...p, schedule: e.target.value })}><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option></select></label></div>}
      {p.mode !== 'regular' && <div className="stack-sm"><span className="small muted">Staged review levels (drop from the 30-day high → hypothetical amount)</span>
        {p.levels.map((l: any, i: number) => <div key={i} className="row"><input className="input" aria-label={`Level ${i + 1} drop %`} inputMode="decimal" value={l.dropPct} onChange={e => set({ ...p, levels: p.levels.map((x: any, k: number) => k === i ? { ...x, dropPct: e.target.value } : x) })} /><span className="faint">% →</span><input className="input" aria-label={`Level ${i + 1} amount`} inputMode="decimal" value={l.amount} onChange={e => set({ ...p, levels: p.levels.map((x: any, k: number) => k === i ? { ...x, amount: e.target.value } : x) })} /><button className="icon-btn" aria-label="Remove level" onClick={() => set({ ...p, levels: p.levels.filter((_: any, k: number) => k !== i) })}><Icon name="close" size={16} /></button></div>)}
        {p.levels.length < 6 && <button className="btn sm" onClick={() => set({ ...p, levels: [...p.levels, { dropPct: '', amount: '' }] })}><Icon name="plus" size={14} />Add level</button>}
        <span className="faint">These levels add up to {money(levelsTotal)} at most. Markets never increases them when prices fall.</span></div>}
      <div className="grid-2"><label className="field">Personal limit for this plan (optional)<input className="input" inputMode="decimal" placeholder="No limit" value={p.maxTotal === '0' ? '' : p.maxTotal} onChange={e => set({ ...p, maxTotal: e.target.value })} /></label>
        <label className="field">Cash comes from<select className="input" value={p.portfolioId ?? ''} onChange={e => set({ ...p, portfolioId: e.target.value || null })}><option value="">Not linked to a portfolio</option>{pfs.data?.data.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label></div>
      <label className="field">Name<input className="input" value={p.name} maxLength={80} onChange={e => set({ ...p, name: e.target.value })} placeholder="e.g. XEQT every month" /></label>
      <div className="notice"><Icon name="info" /><span>A plan is a note to yourself, not an order. Markets never buys, sells or moves money. Recording a real purchase is a separate step in your portfolio.</span></div>
      {err && <p className="notice warn" role="alert">{err}</p>}
    </Dialog>
  );
}

export function Plans() {
  const { search } = useLocation(); const toast = useToast();
  const { data, loading, error, reload } = useApi<{ data: any[]; allocations: any[]; notice: string }>('/plans');
  const [dialog, setDialog] = useState<null | { id?: string; initial: any }>(search.get('new') ? { initial: { instrumentId: search.get('new') } } : null);
  const pfs = useApi<{ data: any[] }>('/portfolios');
  const pfName = (id: string | null) => pfs.data?.data.find(p => p.id === id)?.name ?? 'Not linked';
  return (
    <>
      <div className="page-head"><div><h1>Buy Plans</h1><p>Decide in advance how and when you'd add to an investment.</p></div><button className="btn primary" onClick={() => setDialog({ initial: {} })}><Icon name="plus" />New plan</button></div>
      <ErrorState error={error} retry={reload} />
      {loading && !data ? <div className="card"><Loading rows={4} /></div> : !data?.data.length ? <div className="card"><Empty title="No plans yet" action={<button className="btn primary" onClick={() => setDialog({ initial: {} })}>Create a plan</button>}>Choose regular investing, dip-based review alerts, or both.</Empty></div> : (
        <>
          {data.allocations.filter(a => a.portfolioId).map(a => (
            <div key={a.portfolioId} className={`notice ${a.overcommitted ? 'warn' : ''}`}><Icon name="info" /><span>
              {a.known ? <>{pfName(a.portfolioId)} has {money(a.availableCash)} in cash. Your plans set aside {money(a.totalReserve)}{a.overcommitted ? `, more than you have. Each dollar is only counted once, so the last plans show a shortfall.` : `, leaving ${money(a.unallocated)} unallocated.`}</>
                : <>{pfName(a.portfolioId)}'s cash balance isn't known (some trades have no price), so plan amounts can't be checked against it.</>}
            </span></div>))}
          <div className="grid-2">{data.data.map(p => {
            const alloc = data.allocations.flatMap(a => a.rows).find((r: any) => r.planId === p.id);
            return (
              <article key={p.id} className={`card stack-sm ${p.levelsReached.length ? 'highlight' : ''}`}>
                <div className="row between"><div><h2>{p.name}</h2><span className="faint">{p.mode === 'regular' ? 'Regular investing' : p.mode === 'dip' ? 'Dip review alerts' : 'Hybrid'} · {pfName(p.portfolioId)}</span></div><span className={`chip ${p.status === 'active' ? 'green' : ''}`}>{p.status === 'active' ? 'Active' : p.status === 'paused' ? 'Paused' : 'Archived'}</span></div>
                <div className="row wrap"><Link to={`/assets/${p.instrumentId}`}><b>{p.instrumentId.split('.')[1].toUpperCase()}</b></Link>{p.current && <><Price value={p.current.price} /><span className="faint">30D high</span><Change pct={p.current.dropPct} /></>}</div>
                <dl className="kv">
                  {p.mode !== 'dip' && <><dt>Regular</dt><dd>{money(p.regularAmount)} {p.schedule} (≈{money(p.commitment.monthlyRegular)}/month)</dd></>}
                  {p.mode !== 'regular' && <><dt>Review levels</dt><dd>{p.levels.map((l: any) => `−${l.dropPct}% → ${money(l.amount)}`).join(', ')}</dd></>}
                  <dt>Personal limit</dt><dd>{p.commitment.personalLimit ? money(p.commitment.personalLimit) : 'None'}</dd>
                  <dt>Next review</dt><dd>{dateFmt(p.nextReview)}</dd>
                  {alloc && alloc.covered != null && <><dt>Cash set aside</dt><dd>{money(alloc.covered)}{Number(alloc.shortfall) > 0 && <span className="faint"> (short {money(alloc.shortfall)})</span>}</dd></>}
                </dl>
                {p.levelsReached.length > 0 && <div className="notice green"><Icon name="dip" /><span>Review this asset: the drop has reached {p.levelsReached.length === 1 ? 'your level' : `${p.levelsReached.length} of your levels`} (−{p.levelsReached.map((l: any) => l.dropPct).join('%, −')}%). This is a reminder to review, not a signal to buy.</span></div>}
                <div className="row wrap"><Link to={`/app/what-if?instrument=${p.instrumentId}&amount=${p.mode === 'dip' ? p.levels[0]?.amount ?? '' : p.regularAmount}${p.portfolioId ? `&portfolio=${p.portfolioId}` : ''}`} className="btn sm">Preview in What-If</Link><button className="btn sm ghost" onClick={() => setDialog({ id: p.id, initial: p })}>Edit</button><button className="btn sm ghost" onClick={async () => { await api.patch(`/plans/${p.id}`, { ...p, status: p.status === 'active' ? 'paused' : 'active', portfolioId: p.portfolioId }); void reload(); }}>{p.status === 'active' ? 'Pause' : 'Resume'}</button><button className="btn sm ghost danger" onClick={async () => { if (!confirm('Delete this plan?')) return; await api.del(`/plans/${p.id}`); void reload(); }}>Delete</button></div>
              </article>);
          })}</div>
          <p className="faint">{data.notice}</p>
        </>
      )}
      {dialog && <PlanDialog planId={dialog.id} initial={dialog.initial} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void reload(); toast('Plan saved.'); }} />}
    </>
  );
}

// ---------------- What-If ----------------
export function WhatIf() {
  const { search } = useLocation(); const toast = useToast();
  const pfs = useApi<{ data: any[] }>('/portfolios');
  const [pid, setPid] = useState<string>(search.get('portfolio') ?? '');
  useEffect(() => { if (!pid && pfs.data?.data[0]) setPid(pfs.data.data[0].id); }, [pfs.data, pid]);
  const [a, set] = useState<any>({ type: 'buy', instrumentId: search.get('instrument'), by: 'amount', amount: search.get('amount') || '1000', quantity: '', price: '', fee: '0', funding: 'cash' });
  const [res, setRes] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr('');
    try {
      const body: any = { type: a.type, fee: a.fee || '0', funding: a.funding };
      if (a.type !== 'contribute') { body.instrumentId = a.instrumentId; if (a.price) body.price = a.price; if (a.by === 'amount') body.amount = a.amount; else body.quantity = a.quantity; } else body.amount = a.amount;
      setRes((await api.post(`/portfolios/${pid}/what-if`, body)).data);
    } catch (e: any) { setErr(e.message); setRes(null); } finally { setBusy(false); }
  };
  if (pfs.data && !pfs.data.data.length) return <><div className="page-head"><div><h1>What-If Portfolio</h1></div></div><div className="card"><Empty title="Create a portfolio first" action={<Link to="/app/portfolio" className="btn primary">Go to Portfolio</Link>}>What-If simulates changes to one of your portfolios.</Empty></div></>;
  return (
    <>
      <div className="page-head"><div><h1>What-If Portfolio</h1><p>Simulate a purchase, sale or contribution. Nothing is recorded.</p></div></div>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <label className="field">Portfolio<select className="input" value={pid} onChange={e => { setPid(e.target.value); setRes(null); }}>{pfs.data?.data.map(p => <option key={p.id} value={p.id}>{p.name}{p.kind === 'demo' ? ' (demo)' : ''}</option>)}</select></label>
          <Seg label="Action" value={a.type} onChange={v => set({ ...a, type: v })} options={[{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }, { value: 'contribute', label: 'Contribute cash' }]} />
          {a.type !== 'contribute' && <>
            <InstrumentPicker value={a.instrumentId} tradableOnly onChange={id => set({ ...a, instrumentId: id })} />
            <Seg label="Size by" value={a.by} onChange={v => set({ ...a, by: v })} options={[{ value: 'amount', label: 'Amount' }, { value: 'quantity', label: 'Units' }]} />
          </>}
          <div className="grid-2">
            {a.by === 'amount' || a.type === 'contribute' ? <label className="field">Amount (base currency)<input className="input" inputMode="decimal" value={a.amount} onChange={e => set({ ...a, amount: e.target.value })} /></label> : <label className="field">Units<input className="input" inputMode="decimal" value={a.quantity} onChange={e => set({ ...a, quantity: e.target.value })} /></label>}
            {a.type !== 'contribute' && <label className="field">Assumed price (blank = latest)<input className="input" inputMode="decimal" value={a.price} onChange={e => set({ ...a, price: e.target.value })} /></label>}
          </div>
          {a.type !== 'contribute' && <label className="field">Fee (base currency)<input className="input" inputMode="decimal" value={a.fee} onChange={e => set({ ...a, fee: e.target.value })} /></label>}
          {a.type === 'buy' && <div className="stack-sm"><span className="small muted">Pay with</span><Seg label="Funding" value={a.funding} onChange={v => set({ ...a, funding: v })} options={[{ value: 'cash', label: 'Existing cash' }, { value: 'new_money', label: 'New money' }]} /></div>}
          <button className="btn primary" onClick={run} disabled={busy || !pid || (a.type !== 'contribute' && !a.instrumentId)}>{busy ? 'Simulating…' : 'Simulate'}</button>
          {err && <p className="notice warn" role="alert">{err}</p>}
        </div>
        <div className="card stack">
          {!res ? <Empty title="See the effect before you act">Weights, cash, average cost, sector, country and currency exposure, concentration and estimated dividends.</Empty> : <>
            <div className="notice green"><Icon name="info" /><span>{res.notice}</span></div>
            {res.warnings.map((w: string) => <div key={w} className="notice warn"><Icon name="info" />{w}</div>)}
            <div className="grid-2"><div className="stat"><span className="label">Cash before → after</span><span className="value num" style={{ fontSize: 18 }}>{money(res.cashBefore)} → {money(res.cashAfter)}</span></div><div className="stat"><span className="label">New money added</span><span className="value num" style={{ fontSize: 18 }}>{money(res.newMoney, res.baseCurrency)}</span></div></div>
            <div className="grid-2"><div className="stat"><span className="label">Largest single company</span><span className="value num" style={{ fontSize: 18 }}>{res.before.largestCompanyPct ?? '—'}% → {res.after.largestCompanyPct ?? '—'}%</span></div><div className="stat"><span className="label">Est. annual dividends</span><span className="value num" style={{ fontSize: 18 }}>{money(res.estimatedAnnualDividends.before.annual)} → {money(res.estimatedAnnualDividends.after.annual)}</span></div></div>
            <div className="scroll-x"><table className="t"><thead><tr><th>Holding</th><th className="r">Weight</th><th className="r">Avg cost</th></tr></thead><tbody>{res.holdings.slice(0, 10).map((h: any) => <tr key={h.instrumentId}><td>{h.instrumentId.split('.')[1].toUpperCase()}</td><td className="r num">{h.weightBefore}% → <b>{h.weightAfter}%</b></td><td className="r num">{h.avgCostBefore ? priceFmt(h.avgCostBefore) : '—'} → {h.avgCostAfter ? priceFmt(h.avgCostAfter) : '—'}</td></tr>)}</tbody></table></div>
            <ExposureCompare title="Currency" before={res.before.currencies} after={res.after.currencies} />
            <ExposureCompare title="Sector" before={res.before.sectors} after={res.after.sectors} />
            <ExposureCompare title="Country" before={res.before.countries} after={res.after.countries} />
            <p className="faint">Assumptions: {res.assumptions.join('; ')}. {res.estimatedAnnualDividends.note}</p>
            <div className="row wrap"><button className="btn" onClick={() => setRes(null)}>Reset</button>{a.instrumentId && <Link className="btn" to={`/app/plans?new=${a.instrumentId}`}>Save as a plan</Link>}<Link className="btn ghost" to="/app/portfolio">Record a real transaction</Link></div>
          </>}
        </div>
      </div>
    </>
  );
  void toast;
}

function ExposureCompare({ title, before, after }: { title: string; before: any[]; after: any[] }) {
  const keys = [...new Set([...after, ...before].map(r => r.key))].slice(0, 6);
  return <div className="stack-sm"><h3>{title}</h3>{keys.map(k => { const b = before.find(r => r.key === k)?.pct ?? '0.00', x = after.find(r => r.key === k)?.pct ?? '0.00'; return <div key={k} className="stack-sm" style={{ gap: 4 }}><div className="row between small"><span>{k}</span><span className="num">{b}% → <b>{x}%</b> <span className="faint">({signedPct(Number(x) - Number(b))})</span></span></div><Meter pct={Number(x)} /></div>; })}</div>;
}
