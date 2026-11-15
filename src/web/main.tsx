import { symbolOf } from './lib/format';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { authClient, isDesktopApp } from './lib/api';
import { RouterProvider, match, navigate, useLocation } from './lib/router';
import { AppShell, PublicHeader } from './components/Shell';
import { ToastProvider } from './components/ui';
import { Developers, Start } from './pages/public';
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

// Deferred a tick so the router is already listening when the redirect happens.
function GoTo({ to }: { to: string }) { useEffect(() => { const t = setTimeout(() => navigate(to, { replace: true }), 0); return () => clearTimeout(t); }, [to]); return null; }

function AssetRoute({ id }: { id: string }) {
  if (isDesktopApp()) return <AppShell><Asset id={id} signedIn /></AppShell>;
  return <WebAssetRoute id={id} />;
}

function WebAssetRoute({ id }: { id: string }) {
  const session = authClient.useSession();
  if (session.isPending) return null;
  if (session.data) return <AppShell><Asset id={id} signedIn /></AppShell>;
  return <><PublicHeader /><main className="section stack" id="main"><Asset id={id} signedIn={false} /></main></>;
}

function Routes() {
  const { path } = useLocation();
  // The desktop app has no sign-in or start page: it opens straight into your Markets.
  if (isDesktopApp() && ['/', '/login', '/signup', '/forgot', '/reset'].includes(path)) return <GoTo to="/app" />;
  const titled = (t: string) => { document.title = `${t} | Markets by MP`; };
  // One front door: the start page, with the sign-in, sign-up and reset panels as states of it.
  if (path === '/') { document.title = 'Markets by MP | Your entire investing world'; return <Start key="start" mode="login" />; }
  if (path === '/login') { titled('Sign in'); return <Start key="start" mode="login" />; }
  if (path === '/signup') { titled('Create an account'); return <Start key="start" mode="signup" />; }
  if (path === '/forgot' || path === '/reset') { titled('Reset password'); return <Start key="start" mode="reset" />; }
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

if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_DESKTOP) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => null); });
}
