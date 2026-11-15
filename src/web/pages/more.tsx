import { useState } from 'react';
import { api, authClient, useApi } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { CLASS_LABEL, dateFmt, priceFmt, timeAgo } from '../lib/format';
import { useMe } from '../components/Shell';
import { InstrumentPicker } from '../components/InstrumentPicker';
import { AssetCell, Change, DataBadge, Dialog, Empty, ErrorState, Icon, Loading, Price, Seg, useToast } from '../components/ui';
import { PostCard } from './core';

// ---------------- Onboarding ----------------
export function Welcome() {
  const { me, reload } = useMe();
  const [f, set] = useState({ displayName: me?.displayName ?? '', baseCurrency: me?.baseCurrency ?? 'CAD', interests: me?.interests ?? [] as string[] });
  const finish = async (save: boolean) => { await api.patch('/me', save ? { ...f, onboarded: true } : { onboarded: true }); reload(); navigate('/app/watchlists'); };
  const toggle = (k: string) => set(x => ({ ...x, interests: x.interests.includes(k) ? x.interests.filter(i => i !== k) : [...x.interests, k] }));
  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <div><h1>Welcome to Markets</h1><p className="muted" style={{ marginTop: 6 }}>Three quick questions. You can skip them and change them later in Settings.</p></div>
      <label className="field">What should we call you?<input className="input" value={f.displayName} maxLength={60} onChange={e => set({ ...f, displayName: e.target.value })} /></label>
      <div className="stack-sm"><span className="small muted">Report values in</span><Seg label="Base currency" value={f.baseCurrency} onChange={v => set({ ...f, baseCurrency: v })} options={[{ value: 'CAD', label: 'Canadian dollars' }, { value: 'USD', label: 'US dollars' }]} /></div>
      <div className="stack-sm"><span className="small muted">What do you follow? (optional, used only to suggest related assets)</span><div className="row wrap">{['stock', 'etf', 'crypto', 'mutual_fund', 'index'].map(k => <button key={k} type="button" className="btn sm" aria-pressed={f.interests.includes(k)} style={f.interests.includes(k) ? { borderColor: 'var(--accent)', color: 'var(--accent-text)' } : undefined} onClick={() => toggle(k)}>{CLASS_LABEL[k]}</button>)}</div></div>
      <div className="notice"><Icon name="info" />You don't need a bank connection or any investments to use watchlists, Dip Radar or research.</div>
      <div className="row"><button className="btn primary" onClick={() => finish(true)}>Continue</button><button className="btn ghost" onClick={() => finish(false)}>Skip</button></div>
    </div>
  );
}

// ---------------- Discover ----------------
export function Discover() {
  const { me } = useMe();
  const [cls, setCls] = useState<string>('');
  const [window, setWindow] = useState('30');
  const [min, setMin] = useState('5');
  const dips = useApi<{ data: any[]; definition: string }>(`/screeners/dips?windowDays=${window}&minDropPct=${min}${cls ? `&assetClass=${cls}` : ''}`, [cls, window, min]);
  const [focus, setFocus] = useState<string | null>(null);
  const rel = useApi<{ data: any }>(focus ? `/assets/${focus}/related` : null, [focus]);
  const browse = useApi<{ data: any[] }>(`/assets/search?q=&limit=50${cls ? `&assetClass=${cls}` : ''}`, [cls]);
  return (
    <>
      <div className="page-head"><div><h1>Discover</h1><p>Find related assets and recent pullbacks across Markets' coverage{me?.interests.length ? `, starting with your interests` : ''}.</p></div></div>
      <div className="card stack">
        <h2>Similar & different</h2>
        <div style={{ maxWidth: 420 }}><InstrumentPicker value={focus} onChange={id => setFocus(id)} label="Start from an asset" /></div>
        {rel.loading && focus && <Loading />}
        {rel.data && <><div className="grid-2">{(['similar', 'different'] as const).map(k => <div key={k} className="stack-sm"><h3>{k === 'similar' ? 'Similar exposure' : 'Different exposure'}</h3>{rel.data!.data[k].map((r: any) => <div key={r.instrumentId} className="card" style={{ padding: 12 }}><Link to={`/assets/${r.instrumentId}`}><b>{r.instrumentId.split('.')[1].toUpperCase()}</b></Link><ul className="muted small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.reasons.map((x: string) => <li key={x}>{x}</li>)}</ul></div>)}{!rel.data!.data[k].length && <p className="faint">Nothing stood out.</p>}</div>)}</div><p className="faint">{rel.data.data.disclaimer} {rel.data.data.method}</p></>}
      </div>
      <div className="card flush">
        <div className="card-head"><div><h2>Recent pullbacks</h2><p className="faint">{dips.data?.definition}</p></div><DataBadge meta={dips.data?.data[0]?.quote.meta} /></div>
        <div className="row wrap" style={{ padding: '0 18px 12px' }}>
          <select className="input" style={{ width: 'auto' }} value={cls} onChange={e => setCls(e.target.value)} aria-label="Asset class"><option value="">All types</option><option value="stock">Stocks</option><option value="etf">ETFs</option><option value="crypto">Crypto</option><option value="mutual_fund">Mutual funds</option></select>
          <Seg label="Window" value={window} onChange={setWindow} options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '52 weeks' }]} />
          <Seg label="At least" value={min} onChange={setMin} options={[{ value: '5', label: '5%+' }, { value: '10', label: '10%+' }, { value: '20', label: '20%+' }]} />
        </div>
        {dips.loading && !dips.data ? <div style={{ padding: 18 }}><Loading /></div> : !dips.data?.data.length ? <Empty title="Nothing that far below its high" /> :
          <table className="t responsive"><thead><tr><th>Asset</th><th className="r">Price</th><th className="r">From high</th><th className="r">Today</th></tr></thead><tbody>{dips.data.data.map(r => <tr key={r.instrumentId}><td><AssetCell inst={r.instrument} /></td><td className="r"><Price value={r.quote.price} currency={r.quote.currency} /></td><td className="r"><Change pct={r.dropPct} /></td><td className="r"><Change pct={r.quote.changePct} /></td></tr>)}</tbody></table>}
        <p className="faint" style={{ padding: '10px 18px 16px' }}>A larger decline isn't a better opportunity. This is a list of facts, not recommendations.</p>
      </div>
      <div className="card flush"><div className="card-head"><h2>Browse coverage</h2><span className="faint">{browse.data?.data.length ?? 0} instruments</span></div>
        <table className="t responsive"><tbody>{(browse.data?.data ?? []).map(i => <tr key={i.id}><td><AssetCell inst={i} /></td><td className="hide-m"><span className="chip">{CLASS_LABEL[i.assetClass]}</span></td><td className="r faint">{i.exchange} · {i.currency}</td></tr>)}</tbody></table></div>
    </>
  );
}

// ---------------- Community ----------------
export function Community() {
  const { data, reload } = useApi<{ data: any[]; posting: any }>('/community/posts');
  return (
    <>
      <div className="page-head"><div><h1>Community</h1><p>Learn from how other investors think. Portfolios are always private unless you choose to share.</p></div></div>
      {data?.posting && <div className="notice"><Icon name="info" /><span>{data.posting.reason} Markets won't add copy-trading, return leaderboards or anything that rewards trading more.</span></div>}
      {!data ? <div className="card"><Loading /></div> : data.data.map(p => <PostCard key={p.id} p={p} onBookmark={async () => { await api.post(`/community/posts/${p.id}/bookmark`); void reload(); }} />)}
    </>
  );
}

// ---------------- Calendar ----------------
export function Calendar() {
  const [filter, setFilter] = useState<'all' | 'earnings' | 'dividends' | 'you'>('all');
  const { data, loading, error } = useApi<{ data: any[] }>('/calendar');
  const rows = (data?.data ?? []).filter(e => filter === 'all' || (filter === 'earnings' && e.type === 'earnings') || (filter === 'dividends' && e.type.startsWith('dividend')) || (filter === 'you' && e.source === 'you'));
  const byDate = rows.reduce((m: Record<string, any[]>, e) => { (m[e.date] ??= []).push(e); return m; }, {});
  return (
    <>
      <div className="page-head"><div><h1>Calendar</h1><p>Earnings and dividends for what you follow, plus your own plan and journal reviews.</p></div><Seg label="Filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'earnings', label: 'Earnings' }, { value: 'dividends', label: 'Dividends' }, { value: 'you', label: 'My reviews' }]} /></div>
      <ErrorState error={error} />
      {loading && !data ? <div className="card"><Loading rows={6} /></div> : !rows.length ? <div className="card"><Empty title="Nothing scheduled">Add instruments to a watchlist to see their events here.</Empty></div> :
        <div className="card flush">{Object.entries(byDate).map(([d, evs]) => <div key={d} style={{ borderBottom: '1px solid var(--border)', padding: '12px 18px' }}><div className="faint" style={{ fontWeight: 600, marginBottom: 6 }}>{dateFmt(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>{evs.map(e => <div key={e.id} className="row between small" style={{ padding: '4px 0' }}><span>{e.instrumentId ? <Link to={`/assets/${e.instrumentId}`}>{e.title}</Link> : e.title}</span><span className={`chip ${e.source === 'you' ? 'green' : !e.confirmed ? 'warn' : ''}`}>{e.source === 'you' ? 'Your review' : e.confirmed ? 'Confirmed' : 'Estimated date'}</span></div>)}</div>)}</div>}
    </>
  );
}

// ---------------- Notifications ----------------
export function Notifications() {
  const { data, loading, reload } = useApi<{ data: any[] }>('/alerts/events');
  const { me, reload: reloadMe } = useMe();
  const prefs = me?.preferences ?? {};
  const toast = useToast();
  return (
    <>
      <div className="page-head"><div><h1>Notifications</h1><p>Alerts from your Dip Radar rules, newest first.</p></div><button className="btn" onClick={async () => { await api.post('/alerts/events/read', {}); void reload(); }}>Mark all read</button></div>
      <div className="notice"><Icon name="info" /><span>Alerts appear here and on the bell. Push and email notifications aren't connected in the beta yet. Rules are checked every 30 minutes. <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={prefs.dailyBrief !== false} onChange={async e => { await api.patch('/me', { preferences: { dailyBrief: e.target.checked } }); reloadMe(); toast('Saved.'); }} />Show the Market Brief on Overview</label></span></div>
      {loading && !data ? <div className="card"><Loading /></div> : !data?.data.length ? <div className="card"><Empty title="No alerts yet" action={<Link to="/app/dip-radar" className="btn primary">Set up a rule</Link>}>When one of your rules matches, it shows up here.</Empty></div> :
        <div className="card flush"><table className="t responsive"><tbody>{data.data.map(e => <tr key={e.id} className={e.readAt ? '' : 'selected'}><td><b>{e.message}</b><div className="faint">Observed {timeAgo(e.observedAt)} · reference {priceFmt(e.reference)}</div></td><td className="r"><Link className="btn sm" to={`/app/dip-radar?context=${e.instrumentId}`}>Review asset</Link></td></tr>)}</tbody></table></div>}
    </>
  );
}

// ---------------- Journal ----------------
export function Journal() {
  const { data, loading, reload } = useApi<{ data: any[] }>('/journal');
  const [edit, setEdit] = useState<any>(null);
  const toast = useToast();
  return (
    <>
      <div className="page-head"><div><h1>Investment Journal</h1><p>Write down why, before you act. Come back and reflect.</p></div><button className="btn primary" onClick={() => setEdit({ title: '', sources: [] })}><Icon name="plus" />New entry</button></div>
      {loading && !data ? <div className="card"><Loading /></div> : !data?.data.length ? <div className="card"><Empty title="No entries yet" action={<button className="btn primary" onClick={() => setEdit({ title: '', sources: [] })}>Write your first entry</button>}>A thesis, your sources, your concerns and when you'll review it.</Empty></div> :
        <div className="grid-2">{data.data.map(j => <article key={j.id} className="card stack-sm"><div className="row between"><h2>{j.title}</h2>{j.instrumentId && <Link to={`/assets/${j.instrumentId}`} className="chip">{j.instrumentId.split('.')[1].toUpperCase()}</Link>}</div>{j.thesis && <p>{j.thesis}</p>}{j.concerns && <p className="muted small"><b>Concerns:</b> {j.concerns}</p>}<div className="row wrap faint">{j.horizon && <span>Horizon: {j.horizon}</span>}{j.reviewDate && <span>Review on {dateFmt(j.reviewDate)}</span>}<span>Updated {timeAgo(j.updatedAt)}</span></div>{j.reflection && <p className="notice green small">{j.reflection}</p>}<div className="row"><button className="btn sm" onClick={() => setEdit(j)}>Edit</button><button className="btn sm ghost danger" onClick={async () => { if (!confirm('Delete this entry?')) return; await api.del(`/journal/${j.id}`); void reload(); }}>Delete</button></div></article>)}</div>}
      {edit && <JournalDialog entry={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); toast('Saved.'); }} />}
    </>
  );
}
function JournalDialog({ entry, onClose, onSaved }: { entry: any; onClose: () => void; onSaved: () => void }) {
  const [j, set] = useState<any>({ thesis: '', concerns: '', horizon: '', reflection: '', reviewDate: null, instrumentId: null, ...entry, sources: (entry.sources ?? []).join('\n') });
  const [err, setErr] = useState('');
  const save = async () => { const body = { title: j.title, instrumentId: j.instrumentId, thesis: j.thesis, concerns: j.concerns, horizon: j.horizon, reflection: j.reflection, reviewDate: j.reviewDate || null, sources: j.sources.split('\n').map((s: string) => s.trim()).filter(Boolean), planId: j.planId ?? null, transactionId: j.transactionId ?? null }; try { if (j.id) await api.patch(`/journal/${j.id}`, body); else await api.post('/journal', body); onSaved(); } catch (e: any) { setErr(e.message); } };
  return (
    <Dialog title={j.id ? 'Edit entry' : 'New journal entry'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!j.title?.trim()} onClick={save}>Save</button></>}>
      <label className="field">Title<input className="input" value={j.title} onChange={e => set({ ...j, title: e.target.value })} /></label>
      <InstrumentPicker value={j.instrumentId} onChange={id => set({ ...j, instrumentId: id })} label="About (optional)" />
      <label className="field">My thesis<textarea className="input" value={j.thesis} onChange={e => set({ ...j, thesis: e.target.value })} /></label>
      <label className="field">Supporting sources (one per line)<textarea className="input" value={j.sources} onChange={e => set({ ...j, sources: e.target.value })} /></label>
      <label className="field">Concerns<textarea className="input" value={j.concerns} onChange={e => set({ ...j, concerns: e.target.value })} /></label>
      <div className="grid-2"><label className="field">Time horizon<input className="input" value={j.horizon} placeholder="e.g. 5+ years" onChange={e => set({ ...j, horizon: e.target.value })} /></label><label className="field">Review on<input className="input" type="date" value={j.reviewDate ?? ''} onChange={e => set({ ...j, reviewDate: e.target.value })} /></label></div>
      {j.id && <label className="field">Later reflection<textarea className="input" value={j.reflection} onChange={e => set({ ...j, reflection: e.target.value })} /></label>}
      {err && <p className="notice warn" role="alert">{err}</p>}
    </Dialog>
  );
}

// ---------------- Connections ----------------
export function Connections() {
  const { data } = useApi<{ data: any[]; note: string; configured: boolean }>('/connections');
  return (
    <>
      <div className="page-head"><div><h1>Connections</h1><p>Read-only links to brokerage accounts.</p></div></div>
      <div className="card stack">
        <Empty title="Account linking isn't available yet" action={<Link to="/app/portfolio" className="btn primary">Add transactions or import a CSV</Link>}>{data?.note}</Empty>
        <div className="grid-3">{[['Banking data access', 'Not offered'], ['Brokerage holdings and transactions (read-only)', 'Planned'], ['Transfers and trading', 'Not part of the beta']].map(([k, v]) => <div key={k} className="card" style={{ padding: 14 }}><b>{k}</b><p className="faint">{v}</p></div>)}</div>
      </div>
    </>
  );
}

// ---------------- Settings ----------------
export function Settings() {
  const { me, reload } = useMe(); const toast = useToast();
  const [f, set] = useState({ displayName: me?.displayName ?? '', baseCurrency: me?.baseCurrency ?? 'CAD' });
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem('markets-theme') ?? 'system'; } catch { return 'system'; } });
  const [del, setDel] = useState(false); const [confirmText, setConfirm] = useState('');
  const applyTheme = (t: string) => { setTheme(t); try { if (t === 'system') { localStorage.removeItem('markets-theme'); delete document.documentElement.dataset.theme; } else { localStorage.setItem('markets-theme', t); document.documentElement.dataset.theme = t; } } catch { /* storage blocked */ } };
  if (!me) return <Loading />;
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>{me.isGuest ? 'You\'re using a guest demo workspace.' : me.email}</p></div></div>
      {me.isGuest && <div className="notice green"><Icon name="info" /><span>Create an account to keep your watchlists, rules, plans and journal. <Link to="/signup">Create an account</Link></span></div>}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack"><h2>Profile</h2>
          <label className="field">Display name<input className="input" value={f.displayName} maxLength={60} onChange={e => set({ ...f, displayName: e.target.value })} /></label>
          <div className="stack-sm"><span className="small muted">Base currency</span><Seg label="Base currency" value={f.baseCurrency} onChange={v => set({ ...f, baseCurrency: v })} options={[{ value: 'CAD', label: 'CAD' }, { value: 'USD', label: 'USD' }]} /><span className="faint">Changing this re-reports values; recorded trade-date exchange rates stay as they were.</span></div>
          <button className="btn primary" onClick={async () => { await api.patch('/me', f); reload(); toast('Saved.'); }}>Save</button></div>
        <div className="card stack"><h2>Appearance</h2><Seg label="Theme" value={theme} onChange={applyTheme} options={[{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
          <h2>Your data</h2><a className="btn" href="/api/v1/me/export" download>Download all my data (JSON)</a>
          <button className="btn" onClick={async () => { await authClient.signOut(); navigate('/'); }}>Sign out</button>
          <button className="btn danger" onClick={() => setDel(true)}>Delete my account</button></div>
      </div>
      <div className="card stack-sm"><h2>Keyboard shortcuts</h2><dl className="kv"><dt><kbd>⌘K</kbd> or <kbd>/</kbd></dt><dd style={{ textAlign: 'left' }}>Search</dd><dt><kbd>g</kbd> then <kbd>o</kbd> <kbd>w</kbd> <kbd>p</kbd> <kbd>d</kbd> <kbd>i</kbd> <kbd>c</kbd> <kbd>s</kbd></dt><dd style={{ textAlign: 'left' }}>Overview, Watchlists, Portfolio, Dip Radar, Discover, Calendar, Settings</dd><dt><kbd>←</kbd> <kbd>→</kbd> on a chart</dt><dd style={{ textAlign: 'left' }}>Read values (hold Shift for 10 days)</dd></dl></div>
      {del && <Dialog title="Delete your account" onClose={() => setDel(false)} footer={<><button className="btn ghost" onClick={() => setDel(false)}>Cancel</button><button className="btn danger" disabled={confirmText !== 'DELETE'} onClick={async () => { await api.del('/me', { confirm: 'DELETE' }); await authClient.signOut().catch(() => null); navigate('/'); }}>Delete everything</button></>}>
        <p>This permanently deletes your account, watchlists, portfolios, transactions, rules, plans and journal. It can't be undone. Download your data first if you want a copy.</p>
        <label className="field">Type DELETE to confirm<input className="input" value={confirmText} onChange={e => setConfirm(e.target.value)} /></label>
      </Dialog>}
    </>
  );
}
