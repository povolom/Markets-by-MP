import { useEffect, useState } from 'react';
import { api, authClient, useApi } from '../lib/api';
import { Link, navigate, useLocation } from '../lib/router';
import { dateFmt, priceFmt } from '../lib/format';
import { PublicHeader, startDemo } from '../components/Shell';
import { Change, Icon, Spark, Wordmark, useToast } from '../components/ui';

function Footer() {
  return <footer className="footer"><span>Markets by MP · Beta. Built by <a href="https://marcantoniopovolo.com">Marcantonio Povolo</a>. Not investment advice; Markets never places trades or moves money.</span><span className="row"><Link to="/developers">Developers</Link><a href="/api/v1/docs">API reference</a><a href="https://github.com/povolom/Markets-by-MP">Open source</a></span></footer>;
}

/** Live tiles for the start page. Crypto and FX are real; the S&P 500 is demo data and labelled. */
function MarketTape() {
  const ids = ['crypto.btc-usd', 'crypto.eth-usd', 'fx.usdcad', 'index.spx'];
  const { data } = useApi<{ data: any[] }>(`/quotes?ids=${ids.join(',')}`);
  const names: Record<string, string> = { 'crypto.btc-usd': 'Bitcoin', 'crypto.eth-usd': 'Ethereum', 'fx.usdcad': 'USD / CAD', 'index.spx': 'S&P 500' };
  const by = new Map((data?.data ?? []).map(q => [q.instrumentId, q]));
  return (
    <div className="tape" aria-label="Markets right now">
      {ids.map(id => {
        const q = by.get(id);
        return (
          <Link key={id} to={`/assets/${id}`} className="tape-item">
            <span className="tape-top"><span>{names[id]}</span>{q?.meta?.provenance === 'demo' ? <span className="tape-tag demo">Demo</span> : q ? <span className="tape-tag live"><i />Live</span> : null}</span>
            <span className="tape-price num">{q ? priceFmt(q.price) : <span className="skeleton" style={{ width: 90, height: 20, display: 'block' }} />}</span>
            {q ? <Change pct={q.changePct} /> : <span className="skeleton" style={{ width: 50, height: 12, display: 'block' }} />}
          </Link>
        );
      })}
    </div>
  );
}

type Mode = 'login' | 'signup' | 'reset';

function PasswordField({ value, onChange, autoComplete, hint, label = 'Password' }: { value: string; onChange: (v: string) => void; autoComplete: string; hint?: string; label?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">{label}
      <span className="pw-wrap"><input className="input" type={show ? 'text' : 'password'} required minLength={autoComplete === 'new-password' ? 10 : undefined} autoComplete={autoComplete} value={value} onChange={e => onChange(e.target.value)} aria-describedby={hint ? 'pw-hint' : undefined} />
        <button type="button" className="pw-toggle" onClick={() => setShow(x => !x)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button></span>
      {hint && <span id="pw-hint" className="faint">{hint}</span>}
    </label>
  );
}

function LoginForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { search } = useLocation();
  const [f, set] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await authClient.signIn.email({ email: f.email, password: f.password, rememberMe: true });
    setBusy(false);
    if (r.error) { setErr(r.error.status === 401 ? 'That email and password don\'t match an account.' : (r.error.message ?? 'Could not sign in.')); return; }
    const next = search.get('next') ?? '';
    navigate(/^\/(app|assets)(\/|$|\?)/.test(next) ? next : '/app');
  };
  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">Email<input className="input" type="email" required autoComplete="email" value={f.email} onChange={e => set({ ...f, email: e.target.value })} /></label>
      <PasswordField value={f.password} onChange={v => set({ ...f, password: v })} autoComplete="current-password" />
      {err && <p className="notice warn" role="alert">{err}</p>}
      <button className="btn primary block lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <button type="button" className="linkish" onClick={() => onMode('reset')}>Forgot your password?</button>
    </form>
  );
}

function SignUpForm({ guest }: { guest: boolean }) {
  const toast = useToast();
  const [f, set] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await authClient.signUp.email({ name: f.name || f.email.split('@')[0], email: f.email, password: f.password });
    setBusy(false);
    if (r.error) { setErr(r.error.message ?? 'Could not create the account.'); return; }
    toast(guest ? 'Account created. Your watchlists, rules and plans came with you; the demo portfolio did not.' : 'Welcome to Markets.');
    navigate('/app/welcome');
  };
  return (
    <form className="stack" onSubmit={submit}>
      {guest && <p className="notice green">Your demo watchlists, rules and plans move to your new account. The demo portfolio stays behind, because its holdings are made up.</p>}
      <label className="field">Name<input className="input" autoComplete="name" value={f.name} onChange={e => set({ ...f, name: e.target.value })} /></label>
      <label className="field">Email<input className="input" type="email" required autoComplete="email" value={f.email} onChange={e => set({ ...f, email: e.target.value })} /></label>
      <PasswordField value={f.password} onChange={v => set({ ...f, password: v })} autoComplete="new-password" hint={f.password && f.password.length < 10 ? `${10 - f.password.length} more characters needed.` : 'At least 10 characters.'} />
      {err && <p className="notice warn" role="alert">{err}</p>}
      <button className="btn primary block lg" disabled={busy || f.password.length < 10}>{busy ? 'Creating your account…' : 'Create free account'}</button>
      <p className="faint">Email verification isn't available in the beta yet, so use an address you can get to later.</p>
    </form>
  );
}

/** The one front door: what Markets is, live prices, and a panel to try the demo, sign in or sign up. */
export function Start({ mode: initial = 'login' }: { mode?: Mode }) {
  const toast = useToast();
  const session = authClient.useSession();
  const [mode, setModeState] = useState<Mode>(initial);
  useEffect(() => setModeState(initial), [initial]);
  const [demoBusy, setDemoBusy] = useState(false);
  const setMode = (m: Mode) => { setModeState(m); navigate(m === 'signup' ? '/signup' : m === 'reset' ? '/forgot' : '/login', { replace: true }); };
  const user = session.data?.user as any;
  const guest = Boolean(user?.isAnonymous);
  const signedIn = Boolean(user) && !guest;
  const demo = async () => { setDemoBusy(true); await startDemo(toast); setDemoBusy(false); };
  return (
    <div className="start">
      <div className="start-glow" aria-hidden />
      <header className="start-head">
        <Wordmark beta />
        <nav aria-label="Site" className="row">
          <Link to="/developers" className="btn ghost sm hide-m">Developers</Link>
          <a href="https://github.com/povolom/Markets-by-MP" className="btn ghost sm hide-m">Open source</a>
          {signedIn && <Link to="/app" className="btn primary sm">Open Markets</Link>}
        </nav>
      </header>

      <main className="start-hero" id="main">
        <section className="start-copy start-intro">
          <span className="pill"><i aria-hidden />Free public beta</span>
          <h1>Your entire investing world.</h1>
          <p className="lede">Research, track, discover and plan in one place. Watchlists, portfolio tracking, Dip Radar, Buy Plans and Portfolio X-Ray, built around rules you set.</p>
        </section>
        <section className="start-copy start-more" aria-label="Highlights">
          <MarketTape />
          <ul className="start-points">
            <li><Icon name="discover" size={17} /><span><b>12,000+ assets.</b> Every US stock and ETF, major TSX listings, top crypto and currencies.</span></li>
            <li><Icon name="dip" size={17} /><span><b>Dip Radar.</b> You define what a dip is; Markets tells you when your rule matches.</span></li>
            <li><Icon name="xray" size={17} /><span><b>Portfolio X-Ray.</b> See through your ETFs to what you actually own.</span></li>
          </ul>
        </section>

        <section className="start-panel" aria-label={signedIn ? 'Your account' : 'Get started'}>
          {signedIn ? (
            <div className="stack">
              <div className="stack-sm"><span className="faint">Signed in as {user?.email}</span><h2 className="panel-title">Welcome back{user?.name ? `, ${String(user.name).split(' ')[0]}` : ''}.</h2></div>
              <Link to="/app" className="btn primary block xl">Open Markets <span aria-hidden>→</span></Link>
              <button className="btn ghost block" onClick={async () => { await authClient.signOut(); toast('Signed out.'); }}>Sign out</button>
            </div>
          ) : (
            <div className="stack">
              <div className="stack-sm">
                <h2 className="panel-title">{mode === 'reset' ? 'Reset your password' : 'Get started'}</h2>
                {mode !== 'reset' && <p className="muted small">Explore everything with a sample portfolio, or sign in to your own.</p>}
              </div>
              {mode !== 'reset' && <>
                <button className="btn demo-btn block xl" onClick={demo} disabled={demoBusy}>
                  <span className="demo-ico" aria-hidden><Icon name="portfolio" size={18} /></span>
                  <span className="demo-txt"><b>{demoBusy ? 'Opening the demo…' : guest ? 'Continue the demo' : 'Explore the demo'}</b><small>No account needed</small></span>
                  <span aria-hidden className="demo-arrow">→</span>
                </button>
                <div className="or"><span>or use your account</span></div>
                <div className="seg full" role="tablist" aria-label="Account">
                  <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>Sign in</button>
                  <button role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>Create account</button>
                </div>
                {mode === 'login' ? <LoginForm onMode={setMode} /> : <SignUpForm guest={guest} />}
              </>}
              {mode === 'reset' && <>
                <div className="notice warn"><Icon name="info" /><span>Password reset by email isn't available yet: the beta has no email provider connected, so reset links can't be delivered. If you're locked out, contact <a href="https://marcantoniopovolo.com/contact">Marcantonio</a>.</span></div>
                <button className="btn block" onClick={() => setMode('login')}>Back to sign in</button>
              </>}
            </div>
          )}
          <p className="panel-foot faint">Markets never places trades or moves money. Not investment advice.</p>
        </section>
      </main>

      <section className="section start-features">
        <div className="section-head"><h2>Everything in one place</h2><p className="muted">Each part connects: spot a move, understand it, see what it does to your portfolio, then save a plan or an alert.</p></div>
        <div className="feature-grid">
          {[
            ['watchlists', 'Watchlists', 'Multiple lists with live quotes and trends, synced across your devices. Add anything by name.'],
            ['portfolio', 'Portfolio', 'Manual entry or CSV import, CAD and USD, dividends, splits and fees, with gains separated from contributions.'],
            ['dip', 'Dip Radar', 'Define what a dip means to you. Markets checks it, explains it, and never calls a fall a bargain.'],
            ['whatif', 'What-If', 'See how a purchase changes weights, cash, currency and concentration before you do anything.'],
            ['community', 'Community', 'See how other investors build their portfolios. Percentages only, never amounts.'],
            ['code', 'Markets API', 'The same versioned API powers the app. Public market-data endpoints are keyless within fair limits.'],
          ].map(([icon, t, d]) => <article key={t} className="feature"><span className="feature-ico"><Icon name={icon} size={18} /></span><h3>{t}</h3><p className="muted small">{d}</p></article>)}
        </div>
      </section>

      <section className="section">
        <div className="sources card">
          <div className="stack-sm"><h2>Where the numbers come from</h2><p className="muted small">Every price in Markets says where it came from and when.</p></div>
          <dl className="source-list">
            <div><dt><span className="tape-tag live"><i />Live</span>Crypto</dt><dd>Real prices from CoinGecko, refreshed every minute. Data provided by CoinGecko.</dd></div>
            <div><dt><span className="tape-tag live"><i />Live</span>Currencies</dt><dd>European Central Bank reference rates, published each working day.</dd></div>
            <div><dt><span className="tape-tag demo">Demo</span>Stocks, ETFs, indexes</dt><dd>Generated demo prices, labelled everywhere, until a licensed stock-data feed is connected. Free stock feeds don't allow showing prices publicly.</dd></div>
          </dl>
        </div>
      </section>
      <Footer />
    </div>
  );
}

export function Developers() {
  const status = useApi<any>('/status');
  const cov = useApi<any>('/coverage');
  const origin = typeof location !== 'undefined' ? location.origin : 'https://markets.marcantoniopovolo.com';
  const curl = `curl ${origin}/api/v1/assets/xnas.aapl/quote`;
  const js = `const res = await fetch('${origin}/api/v1/assets/xtse.xeqt/history?range=1Y');\nconst { data, meta } = await res.json();\nconsole.log(data.length, 'daily bars from', meta.provider);`;
  return (
    <>
      <PublicHeader />
      <div className="section stack" style={{ maxWidth: 980 }}>
        <div className="stack-sm"><span className="badge outline" style={{ justifySelf: 'start' }}>Markets API · v1 beta</span><h1>Build with the Markets API</h1>
          <p className="muted">The same versioned API that powers the Markets app. Public market-data endpoints need no key. Every response says which provider it came from, when the value was observed, and whether it's demo data.</p></div>
        <div className="notice warn"><Icon name="info" /><span><b>Stock, ETF, fund and index prices are generated demo data</b> until a licensed feed is connected. FX rates are real European Central Bank reference rates. Real crypto prices from CoinGecko appear in the Markets app only, because CoinGecko's terms don't allow redistributing them; the API returns <code>403 not_licensed</code> for crypto.</span></div>
        <div className="grid-2">
          <div className="card stack-sm"><h2>Try it</h2><pre className="code">{curl}</pre><pre className="code">{js}</pre><a className="btn primary" href="/api/v1/docs">Open the interactive reference</a><a className="btn" href="/api/v1/openapi.json">Download the OpenAPI spec</a></div>
          <div className="card stack-sm"><h2>Limits and behaviour</h2>
            <dl className="kv"><dt>Keyless access</dt><dd>{status.data?.limits?.publicPerMinute ?? 120} requests a minute per IP</dd><dt>Signed in</dt><dd>{status.data?.limits?.accountPerMinute ?? 600} a minute</dd><dt>Batch quotes</dt><dd>up to {status.data?.limits?.maxBatch ?? 50} instruments</dd><dt>History</dt><dd>daily, up to {status.data?.limits?.maxHistoryDays ?? 1830} days a request</dd><dt>Over the limit</dt><dd><code>429</code> with <code>Retry-After</code></dd><dt>Browser access</dt><dd>CORS open for public GETs</dd><dt>Errors</dt><dd><code>{'{ error: { code, message } }'}</code></dd></dl>
            <p className="faint">Unknown values are <code>null</code>, never <code>0</code>. Money and prices are decimal strings. If an upstream provider fails you get a <code>502</code>, never substitute data.</p></div>
        </div>
        <div className="card stack-sm"><h2>Coverage</h2>
          {cov.data && <><p className="muted">{cov.data.instrumentCount} instruments across {cov.data.assetClasses.map((a: any) => `${a.count} ${a.key}`).join(', ')}. Exchanges: {cov.data.exchanges.map((e: any) => e.key).join(', ')}.</p>
            <div className="scroll-x"><table className="t"><thead><tr><th>Provider</th><th>Used for the API</th><th>Public display</th><th>Redistribution</th><th>Notes</th></tr></thead><tbody>{cov.data.providers.map((p: any) => <tr key={p.id}><td>{p.name}</td><td>{p.usedForPublicApi ? 'Yes' : 'No'}</td><td>{p.rights.publicDisplay ? 'Allowed' : 'Not allowed'}</td><td>{p.rights.apiRedistribution ? 'Allowed' : 'Not allowed'}</td><td className="small muted">{p.rights.notes}</td></tr>)}</tbody></table></div>
            <p className="faint">Not modelled yet: {cov.data.notModelled.join('; ')}.</p></>}
        </div>
        <div className="card stack-sm"><h2>Private data</h2><p className="muted">Endpoints for watchlists, portfolios, alerts, plans and journals need a signed-in session on markets.marcantoniopovolo.com and only ever return your own data. Third-party apps will get access to a user's private data only through explicit, scoped consent, which isn't available yet.</p></div>
        <div className="card stack-sm"><h2>Changelog</h2>{useApi<any>('/changelog').data?.data.map((c: any) => <div key={c.version}><b>{c.version}</b> <span className="faint">{dateFmt(c.date)}</span><ul className="muted small">{c.changes.map((x: string) => <li key={x}>{x}</li>)}</ul></div>)}</div>
      </div>
      <Footer />
    </>
  );
}

export { Spark, api };
