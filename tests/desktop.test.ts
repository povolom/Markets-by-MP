import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop app', () => {
  it('bundles every database migration', () => {
    const bundled = [...readFileSync('src/desktop/migrations.ts', 'utf8').matchAll(/name: '([^']+)'/g)].map(m => m[1]);
    expect(bundled).toEqual(readdirSync('migrations').sort());
  });
  it('only lets the app fetch from the expected data sources', () => {
    const caps = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
    const http = caps.permissions.find((p: any) => p.identifier === 'http:default');
    expect(http.allow.every((a: { url: string }) => a.url.startsWith('https://'))).toBe(true);
  });
});
