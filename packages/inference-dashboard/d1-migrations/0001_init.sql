-- nikcli-inference dashboard initial schema

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  password_hash TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT 'default',
  prefix          TEXT NOT NULL,           -- "nik_live_AbCdEfG…" first 16 chars, shown in UI
  key_hash        TEXT NOT NULL UNIQUE,    -- sha256 of full key
  tier            TEXT NOT NULL DEFAULT 'free',
  monthly_cap_usd REAL,
  last_used_at    INTEGER,
  revoked_at      INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS usage_events (
  id                TEXT PRIMARY KEY,
  api_key_id        TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS usage_key_idx ON usage_events(api_key_id);
CREATE INDEX IF NOT EXISTS usage_user_idx ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS usage_created_idx ON usage_events(created_at);
