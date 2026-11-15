export interface RateLimiter { limit(o: { key: string }): Promise<{ success: boolean }> }

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  API_LIMITER?: RateLimiter;          // Workers Rate Limiting binding (public API)
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;            // e.g. https://markets.marcantoniopovolo.com
  YAHOO_RESEARCH?: string;            // "enabled" turns on the isolated research adapter (dev only)
  EMAIL_PROVIDER?: string;            // not configured in the beta: verification and reset emails are unavailable
  ENVIRONMENT?: string;
  MARKET_DATA?: string;               // "offline" = demo data for everything (tests, no network)
  COINGECKO_API_KEY?: string;
  DATA_KEY_SECRET?: string;
  DESKTOP_PLATFORM?: string;
  GITHUB_REPO?: string;               // owner/name for download counts (default povolom/Markets-by-MP)          // 'darwin' | 'win32' in the desktop app           // encrypts users' personal data keys (falls back to BETTER_AUTH_SECRET)         // optional free CoinGecko Demo key (higher rate limit)               // "production" | "development"
}

export interface Vars { requestId: string; userId: string | null; isAnonymous: boolean; market: import('./market').Market }
export type AppEnv = { Bindings: Env; Variables: Vars };
