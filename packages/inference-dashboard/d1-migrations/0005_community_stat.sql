-- Community usage, rollup-shaped.
--
-- Supersedes `community_usage` (0004). Two things changed.
--
-- The CLI now sends rollups derived from its local database rather than a
-- flattened {messages, tokens, cost} triple, so the columns here mirror
-- `analytics_stat` on the install: the full token breakdown, distinct sessions,
-- tool calls and micro-cent integers.
--
-- `verified` records whether the report carried an account token. Reports are
-- accepted either way — the population that runs its own provider keys is
-- exactly the population without an account, and requiring one would measure
-- only gateway users, who are already counted elsewhere. Recording trust instead
-- of demanding it leaves a verified-only cut available later without a migration.
--
-- Distinct installs are never derivable from these rows: an install that ran
-- three models appears in three of them. Any install count must be a
-- COUNT(DISTINCT install_id) computed here, where the identifiers still exist.
CREATE TABLE IF NOT EXISTS community_stat (
  install_id         TEXT    NOT NULL,
  day                TEXT    NOT NULL,            -- YYYY-MM-DD, UTC
  provider           TEXT    NOT NULL,
  model              TEXT    NOT NULL,
  sessions           INTEGER NOT NULL DEFAULT 0,
  messages           INTEGER NOT NULL DEFAULT 0,
  tool_calls         INTEGER NOT NULL DEFAULT 0,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens       INTEGER NOT NULL DEFAULT 0,
  cost_micro_cents   INTEGER NOT NULL DEFAULT 0,
  duration_ms        REAL    NOT NULL DEFAULT 0,
  verified           INTEGER NOT NULL DEFAULT 0,
  version            TEXT,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY (install_id, day, provider, model)
);

CREATE INDEX IF NOT EXISTS community_stat_day_idx   ON community_stat(day);
CREATE INDEX IF NOT EXISTS community_stat_model_idx ON community_stat(day, model);

-- Per-IP request budget.
--
-- Clamping bounds what one install can contribute; this bounds how many installs
-- one source can invent. Kept in the same D1 rather than a dedicated limiter so
-- the endpoint has no binding to configure and degrades with the database it
-- already needs.
CREATE TABLE IF NOT EXISTS community_ingest_rate (
  bucket     TEXT    NOT NULL,   -- hashed IP + UTC hour
  hits       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (bucket)
);

CREATE INDEX IF NOT EXISTS community_ingest_rate_expiry_idx ON community_ingest_rate(expires_at);
