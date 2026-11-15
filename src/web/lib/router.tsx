// A small history-based router: enough for this app, with no extra dependency.
import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

const Ctx = createContext<{ path: string; search: URLSearchParams }>({ path: '/', search: new URLSearchParams() });

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (!to.includes('#')) window.scrollTo({ top: 0 });
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const read = () => ({ path: location.pathname.replace(/\/+$/, '') || '/', search: new URLSearchParams(location.search) });
  const [loc, setLoc] = useState(read);
  useEffect(() => { const on = () => setLoc(read()); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  return <Ctx.Provider value={loc}>{children}</Ctx.Provider>;
}

export const useLocation = () => useContext(Ctx);

/** Matches "/assets/:id" style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/'), b = path.split('/');
  if (a.length !== b.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) out[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return out;
}

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={to} {...rest} onClick={e => {
      rest.onClick?.(e);
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || to.startsWith('http')) return;
      e.preventDefault(); navigate(to);
    }}>{children}</a>
  );
}
