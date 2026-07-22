-- OAuth (identity-token) calls have no API key: relax usage_events.api_key_id
-- to nullable and drop its FK so gateway usage from signed-in accounts can be
-- recorded. SQLite cannot alter constraints in place — rebuild the table.
CREATE TABLE usage_events_new (
  id                TEXT PRIMARY KEY,
  api_key_id        TEXT,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model             TEXT NOT NULL,
  resolved_model    TEXT NOT NULL,
  provider          TEXT,
  upstream_model    TEXT,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  billed_usd        REAL NOT NULL DEFAULT 0,
  upstream_usd      REAL NOT NULL DEFAULT 0,
  saved_usd         REAL NOT NULL DEFAULT 0,
  cache             TEXT,
  rid               TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO usage_events_new SELECT * FROM usage_events;
DROP TABLE usage_events;
ALTER TABLE usage_events_new RENAME TO usage_events;
CREATE INDEX IF NOT EXISTS usage_key_idx ON usage_events(api_key_id);
CREATE INDEX IF NOT EXISTS usage_user_idx ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS usage_created_idx ON usage_events(created_at);
