export interface RateLimiter { limit(o: { key: string }): Promise<{ success: boolean }> }

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  API_LIMITER?: RateLimiter;          // Workers Rate Limiting binding (public API)
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;            // e.g. https://markets.marcantoniopovolo.com
  YAHOO_RESEARCH?: string;            // "enabled" turns on the isolated research adapter (dev only)
  EMAIL_PROVIDER?: string;            // not configured in the beta: verification and reset emails are unavailable
  ENVIRONMENT?: string;               // "production" | "development"
}

export interface Vars { requestId: string; userId: string | null; isAnonymous: boolean }
export type AppEnv = { Bindings: Env; Variables: Vars };
