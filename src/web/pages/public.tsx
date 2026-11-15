import { symbolOf } from '../lib/format';
import { useState } from 'react';
import { api, authClient, useApi } from '../lib/api';
import { Link, navigate, useLocation } from '../lib/router';
import { dateFmt, priceFmt } from '../lib/format';
import { PublicHeader, startDemo } from '../components/Shell';
import { AssetCell, Change, DataBadge, Icon, Spark, Wordmark, useToast } from '../components/ui';

function Footer() {
  return <footer className="footer"><span>Markets by MP · Beta. Built by <a href="https://marcantoniopovolo.com">Marcantonio Povolo</a>. Not investment advice; Markets never places trades or moves money.</span><span className="row"><Link to="/developers">Developers</Link><a href="/api/v1/docs">API reference</a><a href="https://github.com/povolom/Markets-by-MP">Open source</a></span></footer>;
}

function LiveStrip() {
  const { data } = useApi<{ data: any }>('/markets/overview');
  const b = data?.data?.benchmarks ?? [];
  return (
    <div className="card flush">
      <div className="card-head"><h2>Markets right now</h2><DataBadge meta={data?.data?.meta} /></div>
      <table className="t responsive"><thead><tr><th>Benchmark</th><th className="r">Last</th><th className="r">Today</th></tr></thead>
        <tbody>{b.map((q: any) => <tr key={q.instrumentId}><td>{symbolOf(q.instrumentId)}</td><td className="r num">{priceFmt(q.price)}</td><td className="r"><Change pct={q.changePct} /></td></tr>)}</tbody></table>
    </div>
  );
}

export function Landing() {
  const toast = useToast();
  const dips = useApi<{ data: any[] }>('/screeners/dips?windowDays=30&minDropPct=6&sort=drop');
  return (
    <>
      <PublicHeader />
      <section className="hero">
        <img src="/icons/icon-192.png" alt="" className="hero-logo" width={72} height={72} />
        <div className="row" style={{ justifyContent: 'center', marginBottom: 18 }}><span className="badge outline">Beta</span><span className="faint">Demo data until licensed market data is connected</span></div>
        <h1>Your entire investing world.</h1>
        <p className="tagline">Research. Track. Discover. Plan.</p>
        <div className="ctas"><button className="btn primary" onClick={() => startDemo(toast)}>Explore the demo</button><Link to="/signup" className="btn">Create a free account</Link></div>
        <p className="faint" style={{ marginTop: 12 }}>No bank connection needed. Watchlists work without any investments.</p>
      </section>
      <section className="section" style={{ paddingTop: 10 }}>
        <div className="flow" aria-label="How Markets connects">{['Spot a move', 'Understand the context', 'See your portfolio impact', 'Save a plan or alert', 'Review later'].map((s, i, a) => <span key={s} className="row" style={{ gap: 8 }}><span className="step">{s}</span>{i < a.length - 1 && <span className="arrow" aria-hidden>→</span>}</span>)}</div>
      </section>
      <section className="section grid-2">
        <div className="card flush">
          <div className="card-head"><div><h2>Dip Radar</h2><p className="faint">More than 6% below their 30-day closing high</p></div><span className="badge demo">Demo data</span></div>
          <table className="t responsive"><thead><tr><th>Asset</th><th className="r">From 30D high</th><th className="r">Today</th></tr></thead>
            <tbody>{(dips.data?.data ?? []).slice(0, 5).map(r => <tr key={r.instrumentId}><td><AssetCell inst={r.instrument} /></td><td className="r"><Change pct={r.dropPct} /></td><td className="r"><Change pct={r.quote.changePct} /></td></tr>)}</tbody></table>
          <p className="faint" style={{ padding: '10px 18px 16px' }}>A lower price doesn't establish better value. Dip Radar tells you when your own rules match.</p>
        </div>
        <LiveStrip />
      </section>
      <section className="section">
        <div className="feature-grid">
          {[
            ['Watchlists', 'Follow anything', 'Multiple lists with live quotes, sparklines and alerts, synced across your devices.'],
            ['Portfolio', 'Track honestly', 'Manual entry or CSV import, CAD and USD, dividends, splits and fees, with gains separated from contributions.'],
            ['Dip Radar', 'Rules, not hunches', 'Define what a dip means to you. Markets checks it, explains it, and never calls a fall a bargain.'],
            ['What-If', 'Try before you record', 'See how a purchase changes weights, cash, currency and concentration before you do anything.'],
            ['Portfolio X-Ray', 'See through your funds', 'Look-through company exposure, ETF overlap and sector, country and currency concentration.'],
            ['Markets API', 'Built in the open', 'The same versioned API powers the app. Public market-data endpoints are keyless within fair limits.'],
          ].map(([k, t, d]) => <article key={k} className="feature"><span className="k">{k}</span><h3>{t}</h3><p className="muted small">{d}</p></article>)}
        </div>
      </section>
      <section className="section">
        <div className="notice"><Icon name="info" /><span>Markets is a research and tracking tool. Plans are notes to yourself, not orders, and Markets never buys, sells or moves money. All prices in the beta are generated demo data, clearly labelled wherever they appear.</span></div>
      </section>
      <Footer />
    </>
  );
}

/** Sign-in and sign-up layout: the brand on one side, the form on the other (stacked on phones). */
function AuthFrame({ title, children, sub }: { title: string; sub?: string; children: React.ReactNode }) {
  const pts = [38, 42, 40, 47, 45, 52, 50, 58, 55, 61, 59, 66, 63, 70, 74, 71, 78];
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * 300},${100 - v}`).join('');
  return (
    <div className="auth-split">
      <aside className="auth-brand" aria-hidden>
        <Wordmark />
        <div className="stack">
          <h2 className="auth-tagline">Your entire investing world.</h2>
          <p className="muted">Research. Track. Discover. Plan.</p>
          <svg viewBox="0 0 300 100" className="auth-chart"><defs><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".22" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs><path d={`${d}L300,100L0,100Z`} fill="url(#ag)" /><path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" /></svg>
          <ul className="auth-points">
            <li><Icon name="dip" size={16} />Dip Radar tells you when your own rules match</li>
            <li><Icon name="xray" size={16} />See through your ETFs with Portfolio X-Ray</li>
            <li><Icon name="whatif" size={16} />Try a purchase in What-If before you record it</li>
          </ul>
        </div>
        <p className="faint">Beta with labelled demo data. Markets never trades or moves money.</p>
      </aside>
      <main className="auth-main" id="main">
        <div className="auth-card">
          <div className="auth-mobile-logo"><Wordmark /></div>
          <div><h1>{title}</h1>{sub && <p className="muted" style={{ marginTop: 8 }}>{sub}</p>}</div>
          {children}
        </div>
      </main>
    </div>
  );
}

function PasswordField({ value, onChange, autoComplete, hint }: { value: string; onChange: (v: string) => void; autoComplete: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">Password
      <span className="pw-wrap"><input className="input" type={show ? 'text' : 'password'} required minLength={autoComplete === 'new-password' ? 10 : undefined} autoComplete={autoComplete} value={value} onChange={e => onChange(e.target.value)} aria-describedby={hint ? 'pw-hint' : undefined} />
        <button type="button" className="pw-toggle" onClick={() => setShow(x => !x)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button></span>
      {hint && <span id="pw-hint" className="faint">{hint}</span>}
    </label>
  );
}

export function SignUp() {
  const session = authClient.useSession();
  const toast = useToast();
  const [f, set] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const guest = Boolean((session.data?.user as any)?.isAnonymous);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await authClient.signUp.email({ name: f.name || f.email.split('@')[0], email: f.email, password: f.password });
    setBusy(false);
    if (r.error) { setErr(r.error.message ?? 'Could not create the account.'); return; }
    toast(guest ? 'Account created. Your watchlists, rules and plans came with you; the demo portfolio did not.' : 'Welcome to Markets.');
    navigate('/app/welcome');
  };
  return (
    <AuthFrame title="Create your account" sub={guest ? 'Your demo watchlists, rules and plans move to your new account. The demo portfolio stays behind, because its holdings are made up.' : 'Free. No bank connection needed.'}>
      <form className="stack" onSubmit={submit}>
        <label className="field">Name<input className="input" autoComplete="name" value={f.name} onChange={e => set({ ...f, name: e.target.value })} /></label>
        <label className="field">Email<input className="input" type="email" required autoComplete="email" value={f.email} onChange={e => set({ ...f, email: e.target.value })} /></label>
        <PasswordField value={f.password} onChange={v => set({ ...f, password: v })} autoComplete="new-password" hint={f.password && f.password.length < 10 ? `${10 - f.password.length} more characters needed.` : 'At least 10 characters.'} />
        {err && <p className="notice warn" role="alert">{err}</p>}
        <button className="btn primary block lg" disabled={busy || f.password.length < 10}>{busy ? 'Creating your account…' : 'Create account'}</button>
      </form>
      <p className="muted small">Already have an account? <Link to="/login">Log in</Link></p>
      <p className="faint">Email verification isn't available yet in the beta, so please use an address you can get to later.</p>
    </AuthFrame>
  );
}

export function Login() {
  const { search } = useLocation(); const toast = useToast();
  const [f, set] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await authClient.signIn.email({ email: f.email, password: f.password, rememberMe: true });
    setBusy(false);
    if (r.error) { setErr(r.error.status === 401 ? 'That email and password don\'t match an account.' : (r.error.message ?? 'Could not log in.')); return; }
    const next = search.get('next') ?? '';
    navigate(/^\/(app|assets)(\/|$|\?)/.test(next) ? next : '/app');
  };
  return (
    <AuthFrame title="Welcome back" sub="Log in to your watchlists, portfolios and rules.">
      <form className="stack" onSubmit={submit}>
        <label className="field">Email<input className="input" type="email" required autoComplete="email" value={f.email} onChange={e => set({ ...f, email: e.target.value })} /></label>
        <PasswordField value={f.password} onChange={v => set({ ...f, password: v })} autoComplete="current-password" />
        {err && <p className="notice warn" role="alert">{err}</p>}
        <button className="btn primary block lg" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <div className="row between small"><Link to="/signup">Create an account</Link><Link to="/forgot">Forgot password?</Link></div>
      <div className="or"><span>or</span></div>
      <button className="btn block" onClick={() => startDemo(toast)}>Explore the demo, no account needed</button>
    </AuthFrame>
  );
}

export function Forgot() {
  const caps = useApi<any>('/status');
  void caps;
  return (
    <AuthFrame title="Reset your password">
      <div className="notice warn"><Icon name="info" /><span>Password reset by email isn't available yet: the beta doesn't have an email provider connected, so reset links can't be delivered. If you're locked out, contact <a href="https://marcantoniopovolo.com/contact">Marcantonio</a>.</span></div>
      <Link to="/login" className="btn">Back to log in</Link>
    </AuthFrame>
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
        <div className="notice warn"><Icon name="info" /><span><b>All market data is currently generated demo data.</b> No licensed production market-data provider is connected yet, so nothing here is a real price. The contract stays the same when one is.</span></div>
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
