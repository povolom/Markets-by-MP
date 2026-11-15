-- Public usage counts shown on the website: API calls per day, split by who made them ('app' = the Markets
-- web app, 'api' = outside clients). No IPs, users or paths are stored.
CREATE TABLE usage_daily (
  day TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  kind TEXT NOT NULL,         -- 'app' | 'api'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
