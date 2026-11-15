// Writes docs/openapi.json from a running dev server: `npm run dev` in one terminal, then `npm run openapi`.
const res = await fetch('http://localhost:5173/api/v1/openapi.json');
const spec = await res.json();
spec.servers = [{ url: 'https://markets.marcantoniopovolo.com' }];
await (await import('node:fs/promises')).writeFile('docs/openapi.json', JSON.stringify(spec, null, 1));
console.log(Object.keys(spec.paths).length, 'paths written to docs/openapi.json');
