// Cloudflare Worker for markets.marcantoniopovolo.com.
// The website is the static files in site/. Anything under /api/ is this app's API, so the app and
// its API live together at one address. While Markets by MP is coming soon, the API only reports its status.
const APP = {
  name: 'Markets by MP',
  status: 'coming soon',
  site: 'https://markets.marcantoniopovolo.com',
  about: 'https://marcantoniopovolo.com/projects/markets',
  code: 'https://github.com/povolom/Markets-by-MP',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api(request, url);
    return env.ASSETS.fetch(request);
  },
};

function api(request, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return json({ error: 'Only GET requests are supported.' }, 405);
  if (['/api', '/api/', '/api/status'].includes(url.pathname)) return json(APP);
  return json({ error: 'No such endpoint.', try: '/api/status' }, 404);
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2) + '\n', {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});
