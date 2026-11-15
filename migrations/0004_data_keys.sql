-- Personal market-data keys. Each user's key is used only for that user's own requests and alerts,
-- which keeps within free plans' personal-use terms. Secrets are AES-GCM encrypted; the key is derived
-- from DATA_KEY_SECRET (or BETTER_AUTH_SECRET) and never stored here.
CREATE TABLE data_connections (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                 -- 'alpaca'
  ciphertext TEXT NOT NULL,               -- base64 AES-GCM of {"keyId":..., "secret":...}
  iv TEXT NOT NULL,                       -- base64 12-byte nonce
  hint TEXT NOT NULL,                     -- last 4 characters of the key ID, for display
  status TEXT NOT NULL DEFAULT 'ok',      -- 'ok' | 'invalid'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  checked_at TEXT,
  PRIMARY KEY (user_id, provider)
);
