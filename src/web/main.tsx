import { symbolOf } from './lib/format';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { authClient } from './lib/api';
import { RouterProvider, match, useLocation } from './lib/router';
import { AppShell, PublicHeader } from './components/Shell';
import { ToastProvider } from './components/ui';
import { Developers, Forgot, Landing, Login, SignUp } from './pages/public';
import { Asset, Overview, Watchlists } from './pages/core';
import { DipRadar, Plans, WhatIf } from './pages/dips';
import { Portfolio } from './pages/portfolio';
import { Calendar, Connections, Discover, Journal, Notifications, Settings, Welcome } from './pages/more';
import { Community } from './pages/community';

const APP: Record<string, () => React.ReactElement> = {
  '/app': () => <Overview />, '/app/watchlists': () => <Watchlists />, '/app/portfolio': () => <Portfolio />, '/app/dip-radar': () => <DipRadar />,
  '/app/discover': () => <Discover />, '/app/community': () => <Community />, '/app/plans': () => <Plans />, '/app/what-if': () => <WhatIf />,
  '/app/calendar': () => <Calendar />, '/app/notifications': () => <Notifications />, '/app/journal': () => <Journal />,
  '/app/connections': () => <Connections />, '/app/settings': () => <Settings />, '/app/welcome': () => <Welcome />,
};

function NotFound() {
  return <><PublicHeader /><div className="section stack-sm"><h1>Page not found</h1><p className="muted">That page doesn't exist. <a href="/">Go home</a>.</p></div></>;
}

function AssetRoute({ id }: { id: string }) {
  const session = authClient.useSession();
  if (session.isPending) return null;
  if (session.data) return <AppShell><Asset id={id} signedIn /></AppShell>;
  return <><PublicHeader /><main className="section stack" id="main"><Asset id={id} signedIn={false} /></main></>;
}

function Routes() {
  const { path } = useLocation();
  const titled = (t: string) => { document.title = `${t} | Markets by MP`; };
  if (path === '/') { document.title = 'Markets by MP | Your entire investing world'; return <Landing />; }
  if (path === '/login') { titled('Log in'); return <Login />; }
  if (path === '/signup') { titled('Create an account'); return <SignUp />; }
  if (path === '/forgot' || path === '/reset') { titled('Reset password'); return <Forgot />; }
  if (path === '/developers') { titled('Developers'); return <Developers />; }
  const asset = match('/assets/:id', path);
  if (asset) { titled(symbolOf(asset.id) || 'Asset'); return <AssetRoute id={asset.id} />; }
  const page = APP[path];
  if (page) { titled(path === '/app' ? 'Overview' : path.split('/').pop()!.replace('-', ' ').replace(/^\w/, c => c.toUpperCase())); return <AppShell>{page()}</AppShell>; }
  return <NotFound />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><RouterProvider><ToastProvider><Routes /></ToastProvider></RouterProvider></StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => null); });
}
