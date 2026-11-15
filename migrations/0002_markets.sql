-- Markets by MP: the app's own data. Every private row carries user_id and every query filters on it.
-- Money and quantities are stored as decimal TEXT (never floats) and handled with big.js.

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  base_currency TEXT NOT NULL DEFAULT 'CAD' CHECK (base_currency IN ('CAD','USD')),
  interests TEXT NOT NULL DEFAULT '[]',          -- JSON array of asset classes / markets
  preferences TEXT NOT NULL DEFAULT '{}',        -- JSON: theme, notification settings, personalization
  onboarded INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,            -- guest demo workspace
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS watchlists_user ON watchlists(user_id, position);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id TEXT PRIMARY KEY,
  watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (watchlist_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','demo','connected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS portfolios_user ON portfolios(user_id);

CREATE TABLE IF NOT EXISTS portfolio_accounts (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',            -- tfsa, rrsp, fhsa, non_registered, other
  currency TEXT NOT NULL DEFAULT 'CAD'
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reverted_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES portfolio_accounts(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('buy','sell','dividend','fee','deposit','withdrawal','split','interest')),
  instrument_id TEXT,
  trade_date TEXT NOT NULL,                      -- YYYY-MM-DD
  quantity TEXT,                                 -- decimal; for split: the ratio (e.g. 4 for 4-for-1)
  price TEXT,                                    -- decimal, in currency; NULL = unknown cost
  amount TEXT,                                   -- decimal cash amount for deposits, dividends, fees
  currency TEXT NOT NULL DEFAULT 'CAD',
  fx_to_base TEXT,                               -- decimal rate currency -> portfolio base on trade_date
  fee TEXT NOT NULL DEFAULT '0',
  note TEXT NOT NULL DEFAULT '',
  import_batch_id TEXT REFERENCES import_batches(id) ON DELETE CASCADE,
  dedupe_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS transactions_portfolio ON transactions(portfolio_id, trade_date);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_dedupe ON transactions(portfolio_id, dedupe_hash);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL CHECK (scope IN ('instrument','watchlist','holdings')),
  instrument_id TEXT,                            -- scope=instrument
  watchlist_id TEXT REFERENCES watchlists(id) ON DELETE CASCADE,
  portfolio_id TEXT REFERENCES portfolios(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('below_rolling_high','below_52w_high','target_price','below_avg_cost','daily_drop','weekly_drop')),
  threshold TEXT NOT NULL,                       -- percent for drops, price for target_price
  window_days INTEGER NOT NULL DEFAULT 30,
  basis TEXT NOT NULL DEFAULT 'close' CHECK (basis IN ('close','intraday')),
  reset_band TEXT NOT NULL DEFAULT '2',          -- percentage points of recovery needed to re-arm
  cooldown_hours INTEGER NOT NULL DEFAULT 24,
  notify INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS alert_rules_user ON alert_rules(user_id);

-- Per rule and instrument: armed until the threshold is crossed, then disarmed until the reset band is cleared.
CREATE TABLE IF NOT EXISTS alert_state (
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL,
  armed INTEGER NOT NULL DEFAULT 1,
  last_triggered_at TEXT,
  PRIMARY KEY (rule_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  value TEXT NOT NULL,                           -- drop % or price at trigger
  reference TEXT NOT NULL,                       -- reference high / target / avg cost
  message TEXT NOT NULL,
  read_at TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS alert_events_user ON alert_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('regular','dip','hybrid')),
  instrument_id TEXT NOT NULL,
  portfolio_id TEXT REFERENCES portfolios(id) ON DELETE SET NULL,
  schedule TEXT NOT NULL DEFAULT 'monthly',      -- weekly, biweekly, monthly
  regular_amount TEXT NOT NULL DEFAULT '0',
  levels TEXT NOT NULL DEFAULT '[]',             -- JSON [{dropPct, amount}]
  max_total TEXT NOT NULL DEFAULT '0',           -- personal limit for the plan
  currency TEXT NOT NULL DEFAULT 'CAD',
  next_review TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  alert_rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  instrument_id TEXT,
  plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  thesis TEXT NOT NULL DEFAULT '',
  sources TEXT NOT NULL DEFAULT '[]',
  concerns TEXT NOT NULL DEFAULT '',
  horizon TEXT NOT NULL DEFAULT '',
  review_date TEXT,
  reflection TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Read-only account connections (provider-hosted authorization only; no provider configured in the beta).
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  provider TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending','active','partial','expired','disconnected')),
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, post_id)
);
