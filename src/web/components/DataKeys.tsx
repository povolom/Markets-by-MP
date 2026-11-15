import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../lib/api';
import { dateFmt } from '../lib/format';
import { Link } from '../lib/router';
import { Icon, useToast } from './ui';

/** Connect your own free Alpaca key: real US stock and ETF prices, charts and dip alerts, for you only. */
export function DataKeys({ guest }: { guest: boolean }) {
  const toast = useToast();
  const conns = useApi<{ data: { provider: string; hint: string; status: string; createdAt: string }[] }>(guest ? null : '/data-keys');
  const alpaca = conns.data?.data.find(c => c.provider === 'alpaca');
  const [f, set] = useState({ keyId: '', secret: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const connect = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.put('/data-keys/alpaca', { keyId: f.keyId.trim(), secret: f.secret.trim() }); set({ keyId: '', secret: '' }); setEditing(false); conns.reload(); toast('Connected. Real US stock prices are on.'); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const disconnect = async () => { await api.del('/data-keys/alpaca'); conns.reload(); toast('Disconnected. Your key was deleted.'); };
  const connected = alpaca && alpaca.status === 'ok' && !editing;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (location.hash === '#data') ref.current?.scrollIntoView({ block: 'start' }); }, []);

  return (
    <section ref={ref} className="card datakeys" id="data" aria-labelledby="data-h">
      <div className="datakeys-head">
        <span className="datakeys-ico"><Icon name="key" size={20} /></span>
        <div className="stack-sm" style={{ flex: 1 }}>
          <h2 id="data-h">Live stock prices</h2>
          <p className="muted small">Free stock-data plans only allow personal use, so Markets can't show their prices to everyone. Connect your own free Alpaca key and Markets uses it for you alone: real US stock and ETF prices during the day, full price history, charts and Dip Radar alerts.</p>
        </div>
        {connected && <span className="badge live"><i aria-hidden />Connected</span>}
      </div>

      {guest ? (
        <div className="notice"><Icon name="info" /><span>Demo workspaces can't store keys. <Link to="/signup">Create a free account</Link> first.</span></div>
      ) : connected ? (
        <div className="datakeys-on">
          <dl className="kv"><dt>Provider</dt><dd>Alpaca Market Data</dd><dt>Key</dt><dd className="num">•••• {alpaca!.hint}</dd><dt>Connected</dt><dd>{dateFmt(alpaca!.createdAt)}</dd><dt>Covers</dt><dd>Every US-listed stock and ETF</dd></dl>
          <div className="row wrap"><button className="btn sm" onClick={() => setEditing(true)}>Replace key</button><button className="btn ghost sm danger" onClick={disconnect}>Disconnect and delete key</button></div>
        </div>
      ) : (
        <div className="datakeys-steps">
          {alpaca?.status === 'invalid' && <div className="notice warn"><Icon name="info" /><span>Alpaca stopped accepting your saved key. Paste a new pair below.</span></div>}
          <ol className="steps">
            <li><b>Create a free Alpaca account.</b> Choose a paper-trading account: no money, no trading. <a href="https://app.alpaca.markets/signup" target="_blank" rel="noreferrer">Open Alpaca sign-up <Icon name="external" size={13} /></a></li>
            <li><b>Generate API keys.</b> In your Alpaca dashboard, find <i>API Keys</i> and choose <i>Generate</i>. Copy both values; the secret is shown once.</li>
            <li><b>Paste them here.</b> Markets checks the key with Alpaca, then stores it encrypted.</li>
          </ol>
          <form className="datakeys-form" onSubmit={connect}>
            <label className="field">API Key ID<input className="input mono" autoComplete="off" spellCheck={false} value={f.keyId} onChange={e => set({ ...f, keyId: e.target.value })} placeholder="PK…" required /></label>
            <label className="field">Secret Key<input className="input mono" type="password" autoComplete="off" spellCheck={false} value={f.secret} onChange={e => set({ ...f, secret: e.target.value })} required /></label>
            {err && <p className="notice warn" role="alert">{err}</p>}
            <div className="row wrap"><button className="btn primary" disabled={busy || !f.keyId || !f.secret}>{busy ? 'Checking with Alpaca…' : 'Connect'}</button>{editing && <button type="button" className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}</div>
          </form>
          <p className="faint">Your key is encrypted on Markets' server and never sent back to your browser. It's only used to fetch prices for you. Disconnecting deletes it. Canadian listings outside the core list still need a licensed feed.</p>
        </div>
      )}
    </section>
  );
}
