import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, authClient, useApi, useMode } from '../lib/api';
import { Link, navigate, useLocation } from '../lib/router';
import { AssetRowBody, NoMatches, useAssetSearch } from './AssetSearch';
import { Dialog, ErrorState, Icon, Wordmark, useToast } from './ui';

export interface Me { id: string; email: string | null; isGuest: boolean; isDemo: boolean; displayName: string; baseCurrency: string; interests: string[]; preferences: Record<string, any>; onboarded: boolean }
const MeCtx = createContext<{ me: Me | null; reload: () => void }>({ me: null, reload: () => {} });
export const useMe = () => useContext(MeCtx);

const PRIMARY = [
  { to: '/app', label: 'Overview', icon: 'overview' },
  { to: '/app/watchlists', label: 'Watchlists', icon: 'watchlists' },
  { to: '/app/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { to: '/app/dip-radar', label: 'Dip Radar', icon: 'dip' },
  { to: '/app/discover', label: 'Discover', icon: 'discover' },
  { to: '/app/community', label: 'Community', icon: 'community' },
];
const SECONDARY = [
  { to: '/app/plans', label: 'Buy Plans', icon: 'plans' },
  { to: '/app/what-if', label: 'What-If', icon: 'whatif' },
  { to: '/app/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/app/notifications', label: 'Notifications', icon: 'bell' },
  { to: '/app/journal', label: 'Journal', icon: 'journal' },
  { to: '/app/connections', label: 'Connections', icon: 'link' },
  { to: '/app/settings', label: 'Settings', icon: 'settings' },
  { to: '/developers', label: 'Developers', icon: 'code' },
];

function Attribution({ desktop }: { desktop: boolean }) {
  return <p className="side-attrib">{desktop ? <>Stocks and ETFs: Yahoo Finance, fetched on this computer for your personal use. </> : null}Crypto: <a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">data provided by CoinGecko</a>. Currencies: ECB reference rates.{desktop ? '' : ' Stock prices are demo data.'}</p>;
}

export function startDemo(toast: (m: string, k?: 'ok' | 'err') => void) {
  return (async () => {
    const s = await authClient.getSession();
    if (!s.data) { const r = await authClient.signIn.anonymous(); if (r.error) throw new Error(r.error.message ?? 'Could not start the demo.'); }
    await api.post('/demo/seed').catch(() => null);
    navigate('/app');
  })().catch(e => toast(e.message, 'err'));
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const { items, qmap, debounced, loading } = useAssetSearch(q, { limit: 10 });
  const go = (id: string) => { onClose(); navigate(`/assets/${id}`); };
  return (
    <Dialog title="Search" onClose={onClose} bare>
      <div className="search-box big">
        <Icon name="discover" size={19} />
        <input autoFocus placeholder="Search stocks, ETFs, crypto and currencies" value={q} aria-label="Search assets" aria-controls="search-results" role="combobox" aria-expanded aria-activedescendant={items[sel] ? `sr-${items[sel].id}` : undefined} autoComplete="off" spellCheck={false}
          onChange={e => { setQ(e.target.value); setSel(0); }}
          onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); } if (e.key === 'Enter' && items[sel]) go(items[sel].id); }} />
        <kbd className="hide-m">esc</kbd>
      </div>
      <ul className="results" id="search-results" role="listbox" aria-label="Results">
        <li className="results-cap" role="presentation">{debounced ? 'Best matches' : 'Popular'}</li>
        {items.map((i, n) => <li key={i.id} id={`sr-${i.id}`} role="option" aria-selected={n === sel}><Link to={`/assets/${i.id}`} onClick={onClose} className={`result ${n === sel ? 'active' : ''}`} onMouseEnter={() => setSel(n)}><AssetRowBody inst={i} quote={qmap.get(i.id)} /></Link></li>)}
        {!loading && debounced && !items.length && <li role="presentation"><NoMatches q={debounced} /></li>}
      </ul>
    </Dialog>
  );
}

function useShortcuts(openSearch: () => void) {
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
      if (e.key === '/') { e.preventDefault(); openSearch(); return; }
      if (pending.current === 'g') {
        const map: Record<string, string> = { o: '/app', w: '/app/watchlists', p: '/app/portfolio', d: '/app/dip-radar', i: '/app/discover', c: '/app/calendar', s: '/app/settings' };
        if (map[e.key]) navigate(map[e.key]);
        pending.current = null; return;
      }
      if (e.key === 'g') { pending.current = 'g'; setTimeout(() => { pending.current = null; }, 1200); }
    };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [openSearch]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { path } = useLocation();
  const desktop = useMode() === 'desktop';
  const primary = desktop ? PRIMARY.filter(n => n.to !== '/app/community') : PRIMARY;
  const secondary = desktop ? SECONDARY.filter(n => n.to !== '/developers') : SECONDARY;
  // The server decides whether you're signed in (/me), not the client's cached session state, which can
  // lag for a moment right after logging in.
  const { data, reload, error, loading } = useApi<{ data: Me }>('/me');
  const signedIn = Boolean(data?.data);
  const unread = useApi<{ data: any[] }>(signedIn ? '/alerts/events?unread=true' : null, [signedIn, path]);
  const [search, setSearch] = useState(false);
  const [more, setMore] = useState(false);
  const toast = useToast();
  useShortcuts(() => setSearch(true));
  useEffect(() => { if (error?.status === 401) navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); }, [error]);
  useEffect(() => { if (data?.data && !data.data.onboarded && !data.data.isGuest && path !== '/app/welcome') navigate('/app/welcome', { replace: true }); }, [data, path]);
  useEffect(() => setMore(false), [path]);
  const me = data?.data ?? null;
  const count = unread.data?.data.length ?? 0;
  const isActive = (to: string) => (to === '/app' ? path === '/app' : path.startsWith(to));
  if (!me) {
    if (error && error.status !== 401) return <div className="auth-wrap"><div className="stack-sm" style={{ maxWidth: 420 }}><ErrorState error={error} retry={reload} /></div></div>;
    return <div className="auth-wrap" aria-busy={loading}><div className="skeleton" style={{ width: 200, height: 20 }} /></div>;
  }
  return (
    <MeCtx.Provider value={{ me, reload }}>
      <a href="#main" className="skip">Skip to content</a>
      {me?.isGuest && <div className="demo-strip"><span className="badge demo">Demo</span><span>Made-up holdings and demo prices<span className="long">. The app shows real prices on your own computer</span>.</span><Link to="/">Get the app</Link><button className="linkish strong" onClick={async () => { await authClient.signOut(); navigate('/'); }}>Exit demo</button></div>}
      <div className="shell">
        <aside className="sidebar" aria-label="Main navigation">
          <div style={{ padding: '2px 8px' }}><Wordmark to={desktop ? '/app' : '/'} /></div>
          <nav>{primary.map(n => <Link key={n.to} to={n.to} className="navlink" aria-current={isActive(n.to) ? 'page' : undefined} title={n.label}><Icon name={n.icon} /><span className="label">{n.label}</span></Link>)}</nav>
          <div className="nav-sep" />
          <nav>{secondary.map(n => <Link key={n.to} to={n.to} className="navlink" aria-current={isActive(n.to) ? 'page' : undefined} title={n.label}><Icon name={n.icon} /><span className="label">{n.label}</span>{n.icon === 'bell' && count > 0 && <span className="count">{count}</span>}</Link>)}</nav>
          <div className="side-foot stack-sm" style={{ marginTop: 'auto' }}>
            <Attribution desktop={desktop} />
            <p className="faint" style={{ padding: '0 8px', fontSize: 12 }}>Press <kbd>⌘K</kbd> to search.</p>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <span className="hide-desktop" style={{ display: 'none' }} />
            <button className="search-trigger" onClick={() => setSearch(true)} aria-label="Search instruments"><Icon name="discover" size={16} /><span>Search assets</span><kbd>⌘K</kbd></button>
            <div className="row" style={{ marginLeft: 'auto' }}>
              <Link to="/app/notifications" className="icon-btn" aria-label={`Notifications${count ? `, ${count} unread` : ''}`} style={{ position: 'relative' }}><Icon name="bell" />{count > 0 && <span className="badge" style={{ position: 'absolute', top: -2, right: -4, padding: '0 5px' }}>{count}</span>}</Link>
              <Link to="/app/settings" className="avatar" aria-label="Settings and profile">{(me?.displayName || 'M').slice(0, 1).toUpperCase()}</Link>
            </div>
          </header>
          <main id="main" className="page" tabIndex={-1}>{children}</main>
        </div>
      </div>
      <nav className="bottom-nav" aria-label="Main navigation">
        {primary.slice(0, 4).map(n => <Link key={n.to} to={n.to} aria-current={isActive(n.to) ? 'page' : undefined}><Icon name={n.icon} /><span>{n.label === 'Dip Radar' ? 'Dips' : n.label}</span></Link>)}
        <button onClick={() => setMore(true)} aria-haspopup="dialog" aria-current={[...secondary, ...primary.slice(4)].some(n => isActive(n.to)) ? 'page' : undefined}><Icon name="more" /><span>More</span>{count > 0 && <span className="count">{count}</span>}</button>
      </nav>
      {more && <Dialog title="More" onClose={() => setMore(false)}>
        <nav className="stack-sm">{[...primary.slice(4), ...secondary].map(n => <Link key={n.to} to={n.to} className="navlink" aria-current={isActive(n.to) ? 'page' : undefined}><Icon name={n.icon} /><span>{n.label}</span>{n.icon === 'bell' && count > 0 && <span className="count">{count}</span>}</Link>)}</nav>
        {!desktop && <button className="btn ghost" onClick={async () => { await authClient.signOut(); toast('Signed out.'); navigate('/'); }}>Sign out</button>}
        <Attribution desktop={desktop} />
      </Dialog>}
      {search && <SearchDialog onClose={() => setSearch(false)} />}
    </MeCtx.Provider>
  );
}

/** Public pages keep the same search, and show the app's navigation when someone is signed in. */
export function PublicHeader() {
  const session = authClient.useSession();
  const toast = useToast();
  const [search, setSearch] = useState(false);
  useShortcuts(() => setSearch(true));
  return (
    <header className="public-head">
      <Wordmark />
      <nav aria-label="Site">
        <button className="btn ghost sm hide-m" onClick={() => setSearch(true)}><Icon name="discover" size={16} />Search</button>
        <Link to="/developers" className="btn ghost sm hide-m">Developers</Link>
        {session.data ? <Link to="/app" className="btn primary sm">Open the demo</Link> : <button className="btn primary sm" onClick={() => startDemo(toast)}>Try the demo</button>}
      </nav>
      {search && <SearchDialog onClose={() => setSearch(false)} />}
    </header>
  );
}
