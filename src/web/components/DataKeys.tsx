import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../lib/api';
import { dateFmt } from '../lib/format';
import { Link } from '../lib/router';
import { Icon, useToast } from './ui';

interface Conn { provider: 'eodhd' | 'alpaca' | 'questrade'; hint: string; status: string; createdAt: string; meta: { plan?: string | null; dailyLimit?: number | null; covers?: string } | null }

/** Connect your own data key. One EODHD key covers US and Canadian stocks, ETFs and indexes; a free Alpaca
 * key covers US only. Either way the key is encrypted and used only for you. */
export function DataKeys({ guest }: { guest: boolean }) {
  const toast = useToast();
  const conns = useApi<{ data: Conn[] }>(guest ? null : '/data-keys');
  const list = conns.data?.data ?? [];
  const eodhd = list.find(c => c.provider === 'eodhd'), alpaca = list.find(c => c.provider === 'alpaca'), questrade = list.find(c => c.provider === 'questrade');
  const [form, setForm] = useState<null | 'eodhd' | 'alpaca' | 'questrade'>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (location.hash === '#data') ref.current?.scrollIntoView({ block: 'start' }); }, []);
  const disconnect = async (p: string) => { await api.del(`/data-keys/${p}`); conns.reload(); toast('Disconnected. Your key was deleted.'); };
  const done = (msg: string) => { setForm(null); conns.reload(); toast(msg); };
  const connected = list.filter(c => c.status === 'ok');

  return (
    <section ref={ref} className="card datakeys" id="data" aria-labelledby="data-h">
      <div className="datakeys-head">
        <span className="datakeys-ico"><Icon name="key" size={20} /></span>
        <div className="stack-sm" style={{ flex: 1 }}>
          <h2 id="data-h">Live stock prices</h2>
          <p className="muted small">Stock-data providers only allow personal use on their plans, so Markets can't show their prices to everyone. Connect your own key and Markets uses it for you alone: real prices through the day, full history, charts, dividends and Dip Radar alerts.</p>
        </div>
        {connected.length > 0 && <span className="badge live"><i aria-hidden />Connected</span>}
      </div>

      {guest ? (
        <div className="notice"><Icon name="info" /><span>Demo workspaces can't store keys. <Link to="/signup">Create a free account</Link> first.</span></div>
      ) : (
        <div className="stack">
          {connected.map(c => (
            <div key={c.provider} className="conn">
              <div className="conn-main">
                <b>{NAMES[c.provider]}</b>
                <span className="faint">Key •••• {c.hint} · {c.meta?.covers ?? ''} · connected {dateFmt(c.createdAt)}</span>
                {c.provider === 'eodhd' && c.meta?.dailyLimit != null && c.meta.dailyLimit <= 100 && (
                  <p className="notice warn small"><Icon name="info" size={15} /><span>This is EODHD's free plan: {c.meta.dailyLimit} calls a day. That's enough to try it, but a watchlist uses it up quickly, and scheduled dip checks are paused to save your calls. EODHD's EOD + Intraday "All World Extended" plan covers everyday use.</span></p>
                )}
              </div>
              <div className="row"><button className="btn sm" onClick={() => setForm(c.provider)}>Replace</button><button className="btn ghost sm danger" onClick={() => disconnect(c.provider)}>Disconnect</button></div>
            </div>
          ))}
          {list.filter(c => c.status === 'invalid').map(c => <div key={c.provider} className="notice warn"><Icon name="info" /><span>{NAMES[c.provider]} stopped accepting your saved key. <button className="linkish" onClick={() => setForm(c.provider)}>Paste a new one</button></span></div>)}

          {!(questrade && alpaca) && !form && (
            <div className="provider-grid">
              {!questrade && <ProviderCard tag="Free · Canada + US" title="Questrade" points={['TSX, TSX Venture and US stocks and ETFs', 'No daily limit', 'For Questrade customers (any account)']} cta="Connect Questrade" onClick={() => setForm('questrade')} recommended />}
              {!alpaca && <ProviderCard tag="Free · US" title="Alpaca" points={['Every US stock and ETF, live through the day', 'No daily limit', 'Anyone can open a free paper account']} cta="Connect Alpaca" onClick={() => setForm('alpaca')} recommended />}
              {!eodhd && <ProviderCard tag="Paid · One key, every exchange" title="EODHD" points={['US, Canadian and other exchanges, plus main indexes and real dividends', 'Delayed about 15 minutes', 'Free plan is only 20 calls a day; paid plans from about €20/month']} cta="Connect EODHD" onClick={() => setForm('eodhd')} />}
            </div>
          )}
          {!form && <p className="muted small">Best free setup: <b>Questrade</b> if you have it (covers Canada and the US with one key). Otherwise <b>Alpaca</b> for US stocks; Canadian stocks then show prices for the core list, and big Canadian companies link to their New York listing.</p>}
          {form === 'questrade' && <QuestradeForm onDone={() => done('Connected. Real Canadian and US prices are on.')} onCancel={() => setForm(null)} />}
          {form === 'eodhd' && <EodhdForm onDone={() => done('Connected. Real US and Canadian prices are on.')} onCancel={() => setForm(null)} />}
          {form === 'alpaca' && <AlpacaForm onDone={() => done('Connected. Real US stock prices are on.')} onCancel={() => setForm(null)} />}

          <p className="faint">Keys are encrypted on Markets' server, never sent back to your browser, and only used to fetch prices for you. Disconnecting deletes them.</p>
        </div>
      )}
    </section>
  );
}

const NAMES: Record<string, string> = { eodhd: 'EODHD', alpaca: 'Alpaca', questrade: 'Questrade' };

function ProviderCard({ tag, title, points, cta, onClick, recommended }: { tag: string; title: string; points: string[]; cta: string; onClick: () => void; recommended?: boolean }) {
  return (
    <div className={`provider-card ${recommended ? 'recommended' : ''}`}>
      <div className="provider-top"><div><span className={`chip ${recommended ? 'green' : ''}`}>{tag}</span><h3>{title}</h3></div></div>
      <ul className="provider-points">{points.map(p => <li key={p}><Icon name="check" size={15} />{p}</li>)}</ul>
      <button className={`btn ${recommended ? 'primary' : ''}`} onClick={onClick}><Icon name="key" size={16} />{cta}</button>
    </div>
  );
}

function QuestradeForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [token, setToken] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.put('/data-keys/questrade', { token: token.trim() }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="provider-card">
      <ol className="steps">
        <li><b>In Questrade, open the API centre (App Hub)</b> and register a personal app. Give it market-data access only; Markets never needs account or trading access. <a href="https://www.questrade.com/api/documentation/getting-started" target="_blank" rel="noreferrer">Questrade's guide <Icon name="external" size={13} /></a></li>
        <li><b>Generate a new token</b> for that app (manual authorization) and copy it.</li>
        <li><b>Paste it here right away.</b> Tokens work once. Markets signs in with it, then keeps the connection refreshed for you.</li>
      </ol>
      <form className="datakeys-form single" onSubmit={submit}>
        <label className="field">Questrade token<input className="input mono" type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} required /></label>
        {err && <p className="notice warn" role="alert">{err}</p>}
        <div className="row wrap"><button className="btn primary" disabled={busy || token.trim().length < 10}>{busy ? 'Signing in to Questrade…' : 'Connect'}</button><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button></div>
      </form>
    </div>
  );
}

function EodhdForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [token, setToken] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.put('/data-keys/eodhd', { token: token.trim() }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="provider-card">
      <ol className="steps">
        <li><b>Create an EODHD account.</b> <a href="https://eodhd.com/register" target="_blank" rel="noreferrer">Open EODHD sign-up <Icon name="external" size={13} /></a></li>
        <li><b>Copy your API token</b> from your EODHD dashboard.</li>
        <li><b>Paste it here.</b> Markets checks it with EODHD and reads your plan, then stores it encrypted.</li>
      </ol>
      <form className="datakeys-form single" onSubmit={submit}>
        <label className="field">EODHD API token<input className="input mono" type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} required /></label>
        {err && <p className="notice warn" role="alert">{err}</p>}
        <div className="row wrap"><button className="btn primary" disabled={busy || token.trim().length < 8}>{busy ? 'Checking with EODHD…' : 'Connect'}</button><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button></div>
      </form>
    </div>
  );
}

function AlpacaForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [f, set] = useState({ keyId: '', secret: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.put('/data-keys/alpaca', { keyId: f.keyId.trim(), secret: f.secret.trim() }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="provider-card">
      <ol className="steps">
        <li><b>Create a free Alpaca account.</b> Choose paper trading: no money, no trading. <a href="https://app.alpaca.markets/signup" target="_blank" rel="noreferrer">Open Alpaca sign-up <Icon name="external" size={13} /></a></li>
        <li><b>Generate API keys</b> in your Alpaca dashboard (API Keys, Generate). Copy both; the secret is shown once.</li>
        <li><b>Paste them here.</b> Covers US stocks and ETFs only.</li>
      </ol>
      <form className="datakeys-form" onSubmit={submit}>
        <label className="field">API Key ID<input className="input mono" autoComplete="off" spellCheck={false} value={f.keyId} onChange={e => set({ ...f, keyId: e.target.value })} placeholder="PK…" required /></label>
        <label className="field">Secret Key<input className="input mono" type="password" autoComplete="off" spellCheck={false} value={f.secret} onChange={e => set({ ...f, secret: e.target.value })} required /></label>
        {err && <p className="notice warn" role="alert">{err}</p>}
        <div className="row wrap"><button className="btn primary" disabled={busy || !f.keyId || !f.secret}>{busy ? 'Checking with Alpaca…' : 'Connect'}</button><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button></div>
      </form>
    </div>
  );
}
