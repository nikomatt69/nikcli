PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS sync_log_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  device_id TEXT,
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO sync_log_next (
  id,
  user_id,
  session_id,
  device_id,
  operation,
  entity_type,
  entity_id,
  payload,
  hash,
  created_at
)
SELECT
  id,
  user_id,
  session_id,
  device_id,
  operation,
  entity_type,
  entity_id,
  payload,
  hash,
  created_at
FROM sync_log;

DROP TABLE sync_log;
ALTER TABLE sync_log_next RENAME TO sync_log;

CREATE INDEX IF NOT EXISTS idx_sync_log_user_id ON sync_log(user_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_sync_log_user_created ON sync_log(user_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_sync_log_session_created ON sync_log(session_id, created_at ASC);

PRAGMA foreign_keys = ON;
