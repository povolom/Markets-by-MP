-- Community: portfolios people choose to share. Only percentages are ever shown, never amounts,
-- account details or connection data. Sharing is per portfolio and can be turned off at any time.
ALTER TABLE profiles ADD COLUMN handle TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle ON profiles(handle) WHERE handle IS NOT NULL;

CREATE TABLE IF NOT EXISTS shared_portfolios (
  portfolio_id TEXT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  show_holdings INTEGER NOT NULL DEFAULT 1,     -- 0 = only asset-class, sector and country mix
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS portfolio_follows (
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  portfolio_id TEXT NOT NULL,                   -- a shared portfolio ID or a sample portfolio ID
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, portfolio_id)
);
