import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { Link } from '../lib/router';
import { CLASS_LABEL } from '../lib/format';
import { Dialog, Empty, Icon, Loading, Meter, Seg, useToast } from '../components/ui';
import { PostCard } from './core';

const CLASS_COLOR: Record<string, string> = { stock: 'var(--accent)', etf: '#2BB673', crypto: '#F2C94C', mutual_fund: '#7FD1AE', index: '#9AA39E', fx: '#9AA39E', cash: '#55605A' };

function AllocationBar({ classes }: { classes: { key: string; pct: string }[] }) {
  return (
    <div className="alloc" role="img" aria-label={`Allocation: ${classes.map(c => `${CLASS_LABEL[c.key] ?? c.key} ${c.pct}%`).join(', ')}`}>
      {classes.filter(c => Number(c.pct) > 0).map(c => <i key={c.key} style={{ width: `${c.pct}%`, background: CLASS_COLOR[c.key] ?? 'var(--text-3)' }} />)}
    </div>
  );
}
function Legend({ classes }: { classes: { key: string; pct: string }[] }) {
  return <div className="row wrap" style={{ gap: 12 }}>{classes.filter(c => Number(c.pct) > 0).map(c => <span key={c.key} className="legend"><i style={{ background: CLASS_COLOR[c.key] ?? 'var(--text-3)' }} />{c.key === 'cash' ? 'Cash' : CLASS_LABEL[c.key] ?? c.key} <b className="num">{Number(c.pct).toFixed(0)}%</b></span>)}</div>;
}

function PortfolioCard({ p, onOpen, onFollow }: { p: any; onOpen: () => void; onFollow: () => void }) {
  return (
    <article className="pcard">
      <button className="pcard-main" onClick={onOpen} aria-label={`Open ${p.title}`}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="row"><span className="avatar" aria-hidden>{(p.owner.name || p.owner.handle).slice(0, 1).toUpperCase()}</span><div style={{ textAlign: 'left' }}><b>{p.title}</b><div className="faint">@{p.owner.handle}{p.since ? ` · since ${p.since.slice(0, 4)}` : ''}</div></div></div>
          {p.kind === 'sample' ? <span className="badge demo">Sample</span> : <span className="chip">{p.provenance === 'connected' ? 'Connected' : 'Self-reported'}</span>}
        </div>
        <AllocationBar classes={p.assetClasses} />
        <Legend classes={p.assetClasses} />
        {p.holdings.length > 0 ? <div className="pcard-top">{p.holdings.slice(0, 4).map((h: any) => <div key={h.instrumentId} className="row between small"><span><b>{h.symbol}</b> <span className="faint">{h.name.slice(0, 26)}</span></span><span className="num">{h.weightPct}%</span></div>)}{p.holdingCount > 4 && <span className="faint">+{p.holdingCount - 4} more</span>}</div> : <p className="faint">{p.holdingCount} holdings · individual holdings not shared</p>}
        {p.note && <p className="muted small" style={{ textAlign: 'left' }}>{p.note}</p>}
      </button>
      <div className="row between pcard-foot">
        <span className="faint">{p.youAlsoHold.length ? <>You also hold <b style={{ color: 'var(--text)' }}>{p.youAlsoHold.slice(0, 3).join(', ')}</b></> : `${p.followers} following`}</span>
        {p.isMine ? <span className="chip green">Yours</span> : <button className={`btn sm ${p.following ? '' : 'primary'}`} onClick={onFollow} aria-pressed={p.following}>{p.following ? 'Following' : 'Follow'}</button>}
      </div>
    </article>
  );
}

function PortfolioDetail({ p, onClose, onFollow }: { p: any; onClose: () => void; onFollow: () => void }) {
  return (
    <Dialog title={p.title} onClose={onClose} wide footer={!p.isMine ? <button className={`btn ${p.following ? '' : 'primary'}`} onClick={onFollow}>{p.following ? 'Following' : 'Follow this portfolio'}</button> : undefined}>
      <div className="row wrap between"><span className="faint">@{p.owner.handle}{p.since ? ` · investing since ${p.since}` : ''} · {p.holdingCount} holdings</span>{p.kind === 'sample' ? <span className="badge demo">Sample portfolio</span> : <span className="chip">{p.provenance === 'connected' ? 'Connected account' : 'Self-reported holdings, not verified'}</span>}</div>
      {p.note && <p>{p.note}</p>}
      <AllocationBar classes={p.assetClasses} /><Legend classes={p.assetClasses} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack-sm"><h3>Holdings</h3>{p.holdings.length ? p.holdings.map((h: any) => <div key={h.instrumentId} className="stack-sm" style={{ gap: 4 }}><div className="row between small"><Link to={`/assets/${h.instrumentId}`}><b>{h.symbol}</b> <span className="faint">{h.name}</span></Link><span className="num">{h.weightPct}%</span></div><Meter pct={Number(h.weightPct)} /></div>) : <p className="faint">This investor shares their mix but not individual holdings.</p>}
          {Number(p.cashPct) > 0 && <div className="row between small"><span className="faint">Cash</span><span className="num">{p.cashPct}%</span></div>}</div>
        <div className="stack">
          <div className="stack-sm"><h3>Sectors (looking through funds)</h3>{p.sectors.map((r: any) => <div key={r.key} className="row between small"><span className={r.key.startsWith('Not covered') ? 'faint' : ''}>{r.key}</span><span className="num">{r.pct}%</span></div>)}</div>
          <div className="stack-sm"><h3>Countries</h3>{p.countries.map((r: any) => <div key={r.key} className="row between small"><span className={r.key.startsWith('Not covered') ? 'faint' : ''}>{r.key}</span><span className="num">{r.pct}%</span></div>)}</div>
          {p.largestCompanyPct && <p className="faint">Largest single company, including through funds: {p.largestCompanyPct}%.</p>}
        </div>
      </div>
      {p.youAlsoHold.length > 0 && <div className="notice green"><Icon name="info" /><span>You also hold {p.youAlsoHold.join(', ')}.</span></div>}
      <p className="faint">Percentages only: no amounts, balances or account details are ever shared. Returns aren't shown or ranked. How someone else invests isn't advice for you.</p>
    </Dialog>
  );
}

export function Community() {
  const toast = useToast();
  const [tab, setTab] = useState<'portfolios' | 'following' | 'discussions'>('portfolios');
  const list = useApi<{ data: any[]; note: string }>(tab === 'discussions' ? null : `/community/portfolios?filter=${tab === 'following' ? 'following' : 'all'}`, [tab]);
  const posts = useApi<{ data: any[]; posting: any }>(tab === 'discussions' ? '/community/posts' : null, [tab]);
  const [open, setOpen] = useState<any>(null);
  const follow = async (p: any) => { try { const r = await api.post(`/community/portfolios/${p.id}/follow`); toast(r.following ? `Following ${p.title}.` : `Stopped following ${p.title}.`); await list.reload(); setOpen((o: any) => o && o.id === p.id ? { ...o, following: r.following } : o); } catch (e: any) { toast(e.message, 'err'); } };
  return (
    <>
      <div className="page-head"><div><h1>Community</h1><p>See how other investors build their portfolios. Percentages only, never amounts.</p></div><Link to="/app/portfolio?share=1" className="btn primary"><Icon name="community" size={16} />Share your portfolio</Link></div>
      <Seg label="Community view" value={tab} onChange={setTab} options={[{ value: 'portfolios', label: 'Portfolios' }, { value: 'following', label: 'Following' }, { value: 'discussions', label: 'Discussions' }]} />
      {tab !== 'discussions' && (list.loading && !list.data ? <div className="card"><Loading rows={6} /></div> : !list.data?.data.length ? (
        <div className="card"><Empty title={tab === 'following' ? 'You\'re not following any portfolios yet' : 'No shared portfolios yet'} action={tab === 'following' ? <button className="btn primary" onClick={() => setTab('portfolios')}>Browse portfolios</button> : undefined}>Follow a portfolio to keep it here.</Empty></div>
      ) : <>
        <div className="pgrid">{list.data.data.map(p => <PortfolioCard key={p.id} p={p} onOpen={() => setOpen(p)} onFollow={() => follow(p)} />)}</div>
        <p className="faint">{list.data.note}</p>
      </>)}
      {tab === 'discussions' && <div className="stack">{posts.data?.posting && <div className="notice"><Icon name="info" />{posts.data.posting.reason}</div>}{(posts.data?.data ?? []).map(p => <PostCard key={p.id} p={p} onBookmark={async () => { await api.post(`/community/posts/${p.id}/bookmark`); void posts.reload(); }} />)}</div>}
      {open && <PortfolioDetail p={open} onClose={() => setOpen(null)} onFollow={() => follow(open)} />}
    </>
  );
}
