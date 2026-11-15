import { symbolOf } from '../lib/format';
import { useEffect, useState } from 'react';
import { api, useApi } from '../lib/api';
import { Link, useLocation } from '../lib/router';
import { dateFmt, money, priceFmt, signedPct } from '../lib/format';
import { useMe } from '../components/Shell';
import { LineChart } from '../components/Chart';
import { InstrumentPicker } from '../components/InstrumentPicker';
import { AssetCell, Change, Dialog, Empty, ErrorState, Icon, Loading, Meter, Seg, useToast } from '../components/ui';

type Tab = 'holdings' | 'performance' | 'xray' | 'income' | 'transactions';

export function Portfolio() {
  const { search } = useLocation(); const toast = useToast();
  const list = useApi<{ data: any[] }>('/portfolios');
  const [pid, setPid] = useState<string | null>(null);
  useEffect(() => { if (!pid && list.data?.data.length) setPid(list.data.data[0].id); }, [list.data, pid]);
  const [tab, setTab] = useState<Tab>((search.get('tab') as Tab) ?? 'holdings');
  const [dialog, setDialog] = useState<null | 'new' | 'tx' | 'import' | 'rename' | 'share'>(search.get('share') ? 'share' : null);
  const [name, setName] = useState('');
  const pf = useApi<{ data: any }>(pid ? `/portfolios/${pid}` : null, [pid]);
  const reloadAll = () => { void pf.reload(); void list.reload(); };
  const current = list.data?.data.find(p => p.id === pid);
  if (list.loading && !list.data) return <div className="card"><Loading rows={6} /></div>;
  if (!list.data?.data.length) return (
    <>
      <div className="page-head"><div><h1>Portfolio</h1><p>Track holdings, cash, dividends and performance in CAD or USD.</p></div></div>
      <div className="card"><Empty title="Create your first portfolio" action={<button className="btn primary" onClick={() => { setName('My portfolio'); setDialog('new'); }}>Create a portfolio</button>}>Add transactions by hand or import a CSV from your brokerage. Markets never needs your banking password.</Empty></div>
      {dialog === 'new' && <NameDialog title="New portfolio" name={name} setName={setName} onClose={() => setDialog(null)} onSave={async () => { const r = await api.post('/portfolios', { name }); setPid(r.data.id); setDialog(null); reloadAll(); }} />}
    </>
  );
  const s = pf.data?.data.summary;
  return (
    <>
      <div className="page-head">
        <div className="stack-sm"><div className="row wrap"><select className="input" style={{ width: 'auto', fontWeight: 650 }} value={pid ?? ''} onChange={e => setPid(e.target.value)} aria-label="Portfolio">{list.data.data.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{current?.kind === 'demo' && <span className="badge demo">Demo portfolio: made-up holdings</span>}{current?.kind === 'manual' && <span className="chip">Manually entered</span>}</div>
          {s && <div className="row wrap" style={{ alignItems: 'baseline' }}><span className="num" style={{ fontSize: 30, fontWeight: 750 }}>{money(s.totalValue, s.baseCurrency)}</span>{s.unrealizedGain && <Change abs={s.unrealizedGain} currency={s.baseCurrency} />}<span className="faint">unrealized</span></div>}
        </div>
        <div className="row wrap"><button className="btn primary" onClick={() => setDialog('tx')}><Icon name="plus" />Add transaction</button><button className="btn" onClick={() => setDialog('import')}>Import CSV</button><button className="btn" onClick={() => setDialog('share')}><Icon name="community" size={16} />Share</button><button className="btn ghost" onClick={() => { setName(''); setDialog('new'); }}>New portfolio</button></div>
      </div>
      {s && s.warnings.map((w: string) => <div key={w} className="notice warn"><Icon name="info" />{w}</div>)}
      <div className="tabs" role="tablist" aria-label="Portfolio sections">{([['holdings', 'Holdings'], ['performance', 'Performance'], ['xray', 'X-Ray'], ['income', 'Income'], ['transactions', 'Transactions']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      <ErrorState error={pf.error} retry={pf.reload} />
      {pf.loading && !pf.data ? <div className="card"><Loading rows={5} /></div> : pf.data && <>
        {tab === 'holdings' && <Holdings d={pf.data.data} onAdd={() => setDialog('tx')} />}
        {tab === 'performance' && pid && <Performance pid={pid} />}
        {tab === 'xray' && pid && <XRay pid={pid} />}
        {tab === 'income' && pid && <Income pid={pid} base={s.baseCurrency} />}
        {tab === 'transactions' && pid && <Transactions pid={pid} onChange={reloadAll} />}
      </>}
      <div className="row wrap"><button className="btn sm ghost" onClick={() => { setName(current?.name ?? ''); setDialog('rename'); }}>Rename portfolio</button><button className="btn sm ghost danger" onClick={async () => { if (!confirm(`Delete "${current?.name}" and all its transactions? This can't be undone.`)) return; await api.del(`/portfolios/${pid}`); setPid(null); reloadAll(); toast('Portfolio deleted.'); }}>Delete portfolio</button></div>
      {dialog === 'new' && <NameDialog title="New portfolio" name={name} setName={setName} onClose={() => setDialog(null)} onSave={async () => { const r = await api.post('/portfolios', { name }); setPid(r.data.id); setDialog(null); reloadAll(); }} />}
      {dialog === 'rename' && <NameDialog title="Rename portfolio" name={name} setName={setName} onClose={() => setDialog(null)} onSave={async () => { await api.patch(`/portfolios/${pid}`, { name }); setDialog(null); reloadAll(); }} />}
      {dialog === 'tx' && pid && <TxDialog pid={pid} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); reloadAll(); toast('Transaction recorded.'); }} />}
      {dialog === 'share' && pid && <ShareDialog pid={pid} onClose={() => setDialog(null)} />}
      {dialog === 'import' && pid && <ImportDialog pid={pid} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reloadAll(); }} />}
    </>
  );
}

function NameDialog({ title, name, setName, onClose, onSave }: { title: string; name: string; setName: (s: string) => void; onClose: () => void; onSave: () => Promise<void> }) {
  const toast = useToast();
  return <Dialog title={title} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={() => onSave().catch(e => toast(e.message, 'err'))}>Save</button></>}><label className="field">Name<input className="input" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="e.g. TFSA" /></label></Dialog>;
}

function Holdings({ d, onAdd }: { d: any; onAdd: () => void }) {
  const s = d.summary;
  if (!s.holdings.length) return <div className="card"><Empty title="No holdings yet" action={<button className="btn primary" onClick={onAdd}>Add a transaction</button>}>Record a deposit and a purchase, or import a CSV.</Empty></div>;
  return (
    <>
      <div className="grid-3">
        <div className="card stat"><span className="label">Holdings</span><span className="value">{money(s.holdingsValue, s.baseCurrency)}</span></div>
        <div className="card stat"><span className="label">Cash</span><span className="value">{s.cash != null ? money(s.cash, s.baseCurrency) : <span className="faint small">Unknown</span>}</span></div>
        <div className="card stat"><span className="label">Net contributions</span><span className="value">{s.contributionsRecorded ? money(s.netContributions, s.baseCurrency) : <span className="faint small">No deposits recorded</span>}</span></div>
        <div className="card stat"><span className="label">Investment gain</span><span className="value">{s.investmentGain ? <Change abs={s.investmentGain} currency={s.baseCurrency} size={20} /> : <span className="faint small">Needs recorded deposits</span>}</span></div>
        <div className="card stat"><span className="label">Realized gains</span><span className="value">{s.realizedGain != null ? <Change abs={s.realizedGain} currency={s.baseCurrency} size={20} /> : <span className="faint small">Unknown</span>}</span></div>
        <div className="card stat"><span className="label">Income received · fees paid</span><span className="value num" style={{ fontSize: 18 }}>{money(s.income)} · {money(s.fees)}</span></div>
      </div>
      <div className="card flush">
        <table className="t responsive">
          <thead><tr><th>Holding</th><th className="r">Units</th><th className="r hide-m">Avg cost</th><th className="r">Value ({s.baseCurrency})</th><th className="r">Unrealized</th><th className="r hide-m">Weight</th></tr></thead>
          <tbody>{s.holdings.map((h: any) => <tr key={h.instrumentId}>
            <td><HoldingCell id={h.instrumentId} /></td>
            <td className="r num">{Number(h.quantity).toLocaleString('en-CA', { maximumFractionDigits: 8 })}</td>
            <td className="r num hide-m">{h.avgCost ? priceFmt(h.avgCost) : <span className="faint" title="No purchase price recorded">Unknown</span>}</td>
            <td className="r num">{money(h.marketValue)}</td>
            <td className="r">{h.unrealizedGain ? <><Change abs={h.unrealizedGain} /><br /><span className="faint">{signedPct(h.unrealizedGainPct)}</span></> : <span className="faint">Unknown</span>}</td>
            <td className="r hide-m"><span className="num">{h.weightPct ?? '—'}%</span><Meter pct={Number(h.weightPct ?? 0)} /></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="faint">{d.method}</p>
    </>
  );
}
function HoldingCell({ id }: { id: string }) { const { data } = useApi<{ data: any }>(`/assets/${id}`, [id]); return <AssetCell inst={data?.data ?? { id, symbol: symbolOf(id) ?? id, name: '' }} />; }

function Performance({ pid }: { pid: string }) {
  const { me } = useMe();
  const [bench, setBench] = useState(me?.baseCurrency === 'USD' ? 'index.spx' : 'xtse.xeqt');
  const { data, error, loading } = useApi<{ data: any }>(`/portfolios/${pid}/performance?benchmark=${bench}`, [pid, bench]);
  const p = data?.data;
  if (loading && !p) return <div className="card"><Loading rows={5} /></div>;
  if (error) return <ErrorState error={error} />;
  if (!p?.available) return <div className="card"><Empty title="Performance isn't available yet">{p?.reason}</Empty></div>;
  return (
    <>
      <div className="grid-3">
        <div className="card stat"><span className="label">Time-weighted return</span><span className="value"><Change pct={p.timeWeightedReturnPct} size={22} /></span><span className="faint">{dateFmt(p.from)} – {dateFmt(p.to)}</span></div>
        <div className="card stat"><span className="label">Money-weighted return (annualized)</span><span className="value">{p.moneyWeightedReturnPct ? <Change pct={p.moneyWeightedReturnPct} size={22} /> : <span className="faint small">Not enough cash-flow history</span>}</span><span className="faint">{p.moneyWeightedNote}</span></div>
        <div className="card stat"><span className="label">Benchmark, same dates</span><span className="value">{p.benchmark ? <Change pct={p.benchmark.returnPct} size={22} /> : '—'}</span><span className="faint">Volatility {p.volatilityPct ?? '—'}% · worst drop {p.maxDrawdown.pct ?? '—'}%</span></div>
      </div>
      <div className="card">
        <div className="row wrap between" style={{ marginBottom: 12 }}><h2>Growth of 100</h2><Seg label="Benchmark" value={bench} onChange={setBench} options={[{ value: 'xtse.xeqt', label: 'XEQT' }, { value: 'index.spx', label: 'S&P 500' }, { value: 'index.tsx', label: 'TSX' }]} /></div>
        <LineChart points={p.series.map((x: any) => ({ date: x.date, value: Number(x.indexed) }))} bench={p.benchmark?.series.map((x: any) => ({ date: x.date, value: Number(x.indexed) }))} label="Portfolio time-weighted growth of 100" benchLabel={`${bench} total return in ${p.baseCurrency}`} format={v => v.toFixed(1)} />
        <p className="faint" style={{ marginTop: 8 }}>{p.method} {p.benchmark?.method} Solid line: your portfolio. Dashed line: benchmark.</p>
      </div>
    </>
  );
}

function XRay({ pid }: { pid: string }) {
  const { data, error, loading } = useApi<{ data: any }>(`/portfolios/${pid}/xray`, [pid]);
  const x = data?.data;
  if (loading && !x) return <div className="card"><Loading rows={5} /></div>;
  if (error) return <ErrorState error={error} />;
  if (!x || x.totalValue === '0.00') return <div className="card"><Empty title="Nothing to X-Ray yet" /></div>;
  const Bars = ({ title, rows }: { title: string; rows: any[] }) => <div className="card stack-sm"><h2>{title}</h2>{rows.slice(0, 8).map(r => <div key={r.key} className="stack-sm" style={{ gap: 4 }}><div className="row between small"><span className={r.key.startsWith('Not covered') ? 'faint' : ''}>{r.name ?? r.key}</span><span className="num">{r.pct}%</span></div><Meter pct={Number(r.pct)} muted={r.key.startsWith('Not covered')} /></div>)}</div>;
  return (
    <>
      <div className="grid-3">
        <div className="card stat"><span className="label">Largest company exposure</span><span className="value">{x.largestCompanyPct ?? '—'}%</span><span className="faint">Direct plus through funds</span></div>
        <div className="card stat"><span className="label">Concentration index</span><span className="value">{x.concentrationIndex}</span><span className="faint">0 = spread out, 10,000 = one company</span></div>
        <div className="card stat"><span className="label">Funds looked through</span><span className="value">{x.funds.length}</span><span className="faint">{x.funds.map((f: any) => `${symbolOf(f.instrumentId)} ${f.coveragePct}%${f.asOf ? ` as of ${dateFmt(f.asOf)}` : ''}`).join(' · ') || 'None'}</span></div>
      </div>
      <div className="card flush"><div className="card-head"><h2>Company exposure</h2><span className="faint">Direct and through funds</span></div>
        <table className="t responsive"><thead><tr><th>Company</th><th className="r">Total</th><th className="r hide-m">Held directly</th><th className="r">Share</th></tr></thead><tbody>{x.companies.slice(0, 15).map((c: any) => <tr key={c.key}><td className={c.instrumentId ? '' : 'faint'}>{c.instrumentId ? <Link to={`/assets/${c.instrumentId}`}>{c.name}</Link> : c.name}</td><td className="r num">{money(c.value)}</td><td className="r num hide-m">{Number(c.directValue) > 0 ? money(c.directValue) : '—'}</td><td className="r num">{c.pct}%</td></tr>)}</tbody></table></div>
      {x.overlaps.length > 0 && <div className="card stack-sm"><h2>ETF overlap</h2>{x.overlaps.map((o: any) => <div key={o.a + o.b} className="row between small"><span>{symbolOf(o.a)} and {symbolOf(o.b)}</span><span className="num">{o.overlapPct}% overlap <span className="faint">({o.shared.length} shared companies, based on {o.basedOnCoverage.join('% and ')}% coverage)</span></span></div>)}</div>}
      <div className="grid-2"><Bars title="Sector" rows={x.sectors} /><Bars title="Country" rows={x.countries} /><Bars title="Currency" rows={x.currencies} /><Bars title="Asset class" rows={x.assetClasses} /></div>
      <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 600 }}>How X-Ray works</summary><ul className="muted small">{x.methodology.map((m: string) => <li key={m}>{m}</li>)}</ul></details>
    </>
  );
}

function Income({ pid, base }: { pid: string; base: string }) {
  const { data, loading } = useApi<{ data: any }>(`/portfolios/${pid}/income`, [pid]);
  const d = data?.data;
  if (loading && !d) return <div className="card"><Loading rows={4} /></div>;
  if (!d) return null;
  const byYear = d.received.reduce((m: Record<string, number>, r: any) => { const y = r.date.slice(0, 4); m[y] = (m[y] ?? 0) + Number(r.amountBase); return m; }, {});
  return (
    <>
      <div className="grid-2">
        <div className="card stack-sm"><h2>Received</h2>{Object.keys(byYear).length ? Object.entries(byYear).sort().reverse().map(([y, v]) => <div key={y} className="row between"><span>{y}</span><span className="num">{money(v as number, base)}</span></div>) : <p className="muted small">No dividends recorded yet.</p>}</div>
        <div className="card stack-sm"><h2>Coming up</h2>{d.upcoming.slice(0, 8).map((u: any, i: number) => <div key={i} className="row between small"><span>{symbolOf(u.instrumentId)} · ex {dateFmt(u.exDate)}</span><span><span className="num">≈{money(u.estimatedAmount, u.currency)}</span> <span className={`chip ${u.status === 'projected' ? 'warn' : 'green'}`}>{u.status === 'projected' ? 'Projected' : 'Declared'}</span></span></div>)}{!d.upcoming.length && <p className="muted small">Nothing scheduled.</p>}</div>
      </div>
      <p className="faint">{d.note} Base currency: {base}.</p>
    </>
  );
}

function Transactions({ pid, onChange }: { pid: string; onChange: () => void }) {
  const { data, reload } = useApi<{ data: any[] }>(`/portfolios/${pid}/transactions`, [pid]);
  const imports = useApi<{ data: any[] }>('/imports');
  const toast = useToast();
  const batches = (imports.data?.data ?? []).filter(b => b.portfolio_id === pid && !b.reverted_at);
  return (
    <>
      {batches.map(b => <div key={b.id} className="notice"><Icon name="info" /><span>Imported {b.row_count} rows{b.filename ? ` from ${b.filename}` : ''} on {dateFmt(b.created_at)}. <button className="btn sm" onClick={async () => { if (!confirm('Undo this import? Its transactions will be removed.')) return; const r = await api.post(`/imports/${b.id}/revert`); toast(`Removed ${r.removed} transactions.`); void reload(); void imports.reload(); onChange(); }}>Undo import</button></span></div>)}
      <div className="card flush">
        {!data?.data.length ? <Empty title="No transactions" /> : <table className="t responsive"><thead><tr><th>Date</th><th>Type</th><th>Asset</th><th className="r">Units × price</th><th className="r">Amount</th><th /></tr></thead>
          <tbody>{data.data.map(t => <tr key={t.id}><td>{dateFmt(t.tradeDate)}</td><td style={{ textTransform: 'capitalize' }}>{t.type}{t.importBatchId && <span className="faint"> · imported</span>}</td><td>{t.instrumentId ? symbolOf(t.instrumentId) : '—'}</td><td className="r num">{t.quantity ? `${t.quantity}${t.type === 'split' ? '-for-1' : ''}` : ''}{t.price ? ` × ${priceFmt(t.price)}` : t.type === 'buy' || t.type === 'sell' ? ' × unknown' : ''}</td><td className="r num">{t.amount ? money(t.amount, t.currency) : t.price && t.quantity ? money(Number(t.price) * Number(t.quantity), t.currency) : '—'}</td><td className="r"><button className="icon-btn" aria-label="Delete transaction" onClick={async () => { if (!confirm('Delete this transaction?')) return; await api.del(`/portfolios/${pid}/transactions/${t.id}`); void reload(); onChange(); }}><Icon name="trash" size={16} /></button></td></tr>)}</tbody></table>}
      </div>
    </>
  );
}

function TxDialog({ pid, onClose, onSaved }: { pid: string; onClose: () => void; onSaved: () => void }) {
  const [t, set] = useState<any>({ type: 'buy', tradeDate: new Date().toISOString().slice(0, 10), instrumentId: null, quantity: '', price: '', amount: '', fee: '0', note: '' });
  const [err, setErr] = useState('');
  const trade = t.type === 'buy' || t.type === 'sell';
  const save = async () => {
    setErr('');
    const body: any = { type: t.type, tradeDate: t.tradeDate, fee: t.fee || '0', note: t.note };
    if (trade || t.type === 'split' || t.type === 'dividend') body.instrumentId = t.instrumentId;
    if (trade || t.type === 'split') body.quantity = t.quantity;
    if (trade) body.price = t.price === '' ? null : t.price;
    if (!trade && t.type !== 'split') body.amount = t.amount;
    try { const r = await api.post(`/portfolios/${pid}/transactions`, body); if (r.data.possibleDuplicate) alert('Recorded. An identical transaction already existed, so check this isn\'t a duplicate.'); onSaved(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Dialog title="Add a transaction" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Record</button></>}>
      <div className="notice"><Icon name="info" />This records something that already happened. It doesn't place an order.</div>
      <div className="grid-2"><label className="field">Type<select className="input" value={t.type} onChange={e => set({ ...t, type: e.target.value })}><option value="buy">Buy</option><option value="sell">Sell</option><option value="deposit">Deposit (contribution)</option><option value="withdrawal">Withdrawal</option><option value="dividend">Dividend</option><option value="interest">Interest</option><option value="fee">Fee</option><option value="split">Stock split</option></select></label>
        <label className="field">Date<input className="input" type="date" value={t.tradeDate} max={new Date().toISOString().slice(0, 10)} onChange={e => set({ ...t, tradeDate: e.target.value })} /></label></div>
      {(trade || t.type === 'split' || t.type === 'dividend') && <InstrumentPicker value={t.instrumentId} tradableOnly onChange={id => set({ ...t, instrumentId: id })} label={t.type === 'dividend' ? 'Paid by (optional)' : 'Instrument'} />}
      {(trade || t.type === 'split') && <div className="grid-2"><label className="field">{t.type === 'split' ? 'Ratio (e.g. 4 for a 4-for-1 split)' : 'Units'}<input className="input" inputMode="decimal" value={t.quantity} onChange={e => set({ ...t, quantity: e.target.value })} /></label>{trade && <label className="field">Price per unit (leave blank if unknown)<input className="input" inputMode="decimal" value={t.price} onChange={e => set({ ...t, price: e.target.value })} /></label>}</div>}
      {!trade && t.type !== 'split' && <label className="field">Amount<input className="input" inputMode="decimal" value={t.amount} onChange={e => set({ ...t, amount: e.target.value })} /></label>}
      {trade && <label className="field">Fee<input className="input" inputMode="decimal" value={t.fee} onChange={e => set({ ...t, fee: e.target.value })} /></label>}
      <label className="field">Note<input className="input" value={t.note} maxLength={500} onChange={e => set({ ...t, note: e.target.value })} /></label>
      <p className="faint">Prices are in the instrument's currency; Markets converts to your base currency at that day's rate.</p>
      {err && <p className="notice warn" role="alert">{err}</p>}
    </Dialog>
  );
}

function ImportDialog({ pid, onClose, onDone }: { pid: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState(''); const [filename, setFilename] = useState('');
  const [opts, setOpts] = useState({ hasHeader: true, dateFormat: 'ymd' });
  const [mapping, setMapping] = useState<Record<string, number> | null>(null);
  const [prev, setPrev] = useState<any>(null); const [err, setErr] = useState('');
  const preview = async (m = mapping) => { setErr(''); try { const r = await api.post(`/portfolios/${pid}/imports/preview`, { csv, ...opts, ...(m ? { mapping: m } : {}) }); setPrev(r.data); setMapping(r.data.mapping); } catch (e: any) { setErr(e.message); } };
  const commit = async () => { try { const r = await api.post(`/portfolios/${pid}/imports`, { csv, filename, ...opts, mapping }); toast(`Imported ${r.data.imported} transactions${r.data.skippedDuplicates ? `, skipped ${r.data.skippedDuplicates} duplicates` : ''}. You can undo this from Transactions.`); onDone(); } catch (e: any) { setErr(e.message); } };
  return (
    <Dialog title="Import transactions from CSV" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>{prev && <button className="btn primary" disabled={!prev.counts.ok} onClick={commit}>Import {prev.counts.ok} rows</button>}</>}>
      <p className="muted small">Columns Markets understands: date, type (buy, sell, dividend, deposit, withdrawal, fee, interest, split), symbol (use .TO for Toronto), quantity, price, amount, currency, fee, note. You'll see every row before anything is saved, and you can undo the whole import later.</p>
      <input type="file" accept=".csv,text/csv" aria-label="Choose a CSV file" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setFilename(f.name); setCsv(await f.text()); setPrev(null); setMapping(null); }} />
      <textarea className="input" rows={5} placeholder={'Date,Type,Symbol,Quantity,Price,Amount,Currency\n2025-01-02,Deposit,,,,5000,CAD\n2025-01-03,Buy,XEQT.TO,100,32.10,,CAD'} value={csv} onChange={e => { setCsv(e.target.value); setPrev(null); }} aria-label="Or paste CSV" />
      <div className="row wrap"><label className="check"><input type="checkbox" checked={opts.hasHeader} onChange={e => setOpts({ ...opts, hasHeader: e.target.checked })} />First row is a header</label>
        <select className="input" style={{ width: 'auto' }} value={opts.dateFormat} onChange={e => setOpts({ ...opts, dateFormat: e.target.value })} aria-label="Date format"><option value="ymd">Dates like 2025-01-31</option><option value="mdy">Dates like 01/31/2025</option><option value="dmy">Dates like 31/01/2025</option></select>
        <button className="btn" disabled={!csv.trim()} onClick={() => preview()}>Preview</button></div>
      {prev && <>
        <div className="stack-sm"><h3>Column mapping</h3><div className="grid-3">{prev.fields.map((f: string) => <label key={f} className="field" style={{ textTransform: 'capitalize' }}>{f}<select className="input" value={mapping?.[f] ?? ''} onChange={e => { const m = { ...(mapping ?? {}) }; if (e.target.value === '') delete m[f]; else m[f] = Number(e.target.value); setMapping(m); void preview(m); }}><option value="">Not in file</option>{(prev.header ?? prev.rows[0]?.raw ?? []).map((h: string, i: number) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>)}</div></div>
        <div className="row wrap"><span className="chip green">{prev.counts.ok} ready</span><span className="chip">{prev.counts.duplicate} duplicates (skipped)</span><span className={`chip ${prev.counts.error ? 'warn' : ''}`}>{prev.counts.error} with errors (skipped)</span></div>
        <div className="scroll-x" style={{ maxHeight: 280 }}><table className="t"><thead><tr><th>Line</th><th>Status</th><th>Date</th><th>Type</th><th>Symbol</th><th className="r">Qty</th><th className="r">Price</th><th className="r">Amount</th></tr></thead><tbody>{prev.rows.map((r: any) => <tr key={r.line}><td>{r.line}</td><td>{r.status === 'ok' ? <span className="chip green">Ready</span> : <span className="chip warn" title={r.errors.join(' ')}>{r.status === 'duplicate' ? 'Duplicate' : r.errors[0]}</span>}</td><td>{r.tx?.tradeDate ?? ''}</td><td>{r.tx?.type ?? ''}</td><td>{r.tx?.symbol ?? ''}</td><td className="r">{r.tx?.quantity ?? ''}</td><td className="r">{r.tx?.price ?? (r.tx && (r.tx.type === 'buy' || r.tx.type === 'sell') ? 'unknown' : '')}</td><td className="r">{r.tx?.amount ?? ''}</td></tr>)}</tbody></table></div>
      </>}
      {err && <p className="notice warn" role="alert">{err}</p>}
    </Dialog>
  );
}

function ShareDialog({ pid, onClose }: { pid: string; onClose: () => void }) {
  const toast = useToast(); const { me } = useMe();
  const { data, reload } = useApi<{ data: any }>(`/portfolios/${pid}/share`, [pid]);
  const d = data?.data;
  const [f, set] = useState<any>(null);
  useEffect(() => { if (d && !f) set({ title: d.title, note: d.note, showHoldings: d.showHoldings, handle: d.handle ?? (me?.displayName ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) }); }, [d, f, me]);
  const [err, setErr] = useState('');
  const save = async () => { setErr(''); try { await api.put(`/portfolios/${pid}/share`, f); toast('Shared. Others now see this portfolio as percentages only.'); await reload(); onClose(); } catch (e: any) { setErr(e.message); } };
  const stop = async () => { await api.del(`/portfolios/${pid}/share`); toast('No longer shared.'); onClose(); };
  return (
    <Dialog title="Share this portfolio" onClose={onClose} wide footer={d?.canShare && !me?.isGuest ? <>{d.shared && <button className="btn danger" onClick={stop}>Stop sharing</button>}<button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>{d.shared ? 'Update' : 'Share portfolio'}</button></> : <button className="btn" onClick={onClose}>Close</button>}>
      {!d || !f ? <Loading /> : me?.isGuest ? <div className="notice"><Icon name="info" /><span>Create an account to share a portfolio. <Link to="/signup">Create an account</Link></span></div> : !d.canShare ? <div className="notice warn"><Icon name="info" />{d.reason}</div> : <>
        <div className="notice green"><Icon name="info" /><span>Others see percentages only: never amounts, balances, cash values or account details. You can stop sharing at any time.</span></div>
        <div className="grid-2"><label className="field">Title<input className="input" value={f.title} maxLength={60} onChange={e => set({ ...f, title: e.target.value })} /></label>
          <label className="field">Your handle<input className="input" value={f.handle} maxLength={20} onChange={e => set({ ...f, handle: e.target.value.toLowerCase() })} placeholder="e.g. long_term_mp" /></label></div>
        <label className="field">A sentence about your approach (optional)<textarea className="input" value={f.note} maxLength={280} onChange={e => set({ ...f, note: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={f.showHoldings} onChange={e => set({ ...f, showHoldings: e.target.checked })} />Show individual holdings (otherwise only your asset-class, sector and country mix)</label>
        <div className="stack-sm"><h3>What others will see</h3><div className="card" style={{ padding: 14 }}><b>{f.title}</b> <span className="faint">@{f.handle || 'handle'}</span>
          <div className="stack-sm" style={{ marginTop: 10 }}>{(f.showHoldings ? d.preview.holdings : []).slice(0, 6).map((h: any) => <div key={h.instrumentId} className="row between small"><span>{h.symbol}</span><span className="num">{h.weightPct}%</span></div>)}{!f.showHoldings && <span className="faint">Asset classes: {d.preview.assetClasses.map((c: any) => `${c.key} ${Number(c.pct).toFixed(0)}%`).join(', ')}</span>}</div></div></div>
        {err && <p className="notice warn" role="alert">{err}</p>}
      </>}
    </Dialog>
  );
}
