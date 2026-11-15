// Desktop entry: start the embedded Markets API, then the same web app as markets.marcantoniopovolo.com.
// If anything fails on start-up, say so on screen instead of showing a blank window.
import { start } from './embedded';

function showError(e: unknown) {
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  document.body.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = 'font: 14px -apple-system, system-ui, sans-serif; color: #EEF2EF; padding: 48px 32px; max-width: 760px';
  box.innerHTML = '<h1 style="font-size:22px;margin:0 0 12px">Markets couldn\'t start</h1><p style="color:#A3ACA6;margin:0 0 16px">Please report this at github.com/povolom/Markets-by-MP/issues with the details below.</p>';
  const pre = document.createElement('pre'); pre.textContent = msg; pre.style.cssText = 'white-space:pre-wrap;background:#151917;border:1px solid #262C28;border-radius:10px;padding:14px;font-size:12px;color:#A3ACA6';
  box.appendChild(pre); document.body.appendChild(box);
}
window.addEventListener('error', e => showError(e.error ?? e.message));
window.addEventListener('unhandledrejection', e => showError(e.reason));

// The desktop app opens straight into Markets; there's no start or sign-in page.
if (!location.pathname.startsWith('/app') && !location.pathname.startsWith('/assets')) history.replaceState(null, '', '/app');

const ready = start();
(globalThis as { __MARKETS_EMBEDDED__?: typeof ready }).__MARKETS_EMBEDDED__ = ready;
ready.catch(showError);
import('../web/main').catch(showError);
