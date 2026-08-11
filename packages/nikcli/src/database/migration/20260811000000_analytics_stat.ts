import { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260811000000_analytics_stat",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS analytics_stat (
        grain               TEXT    NOT NULL,
        period_key          TEXT    NOT NULL,
        provider            TEXT    NOT NULL,
        model               TEXT    NOT NULL,
        sessions            INTEGER NOT NULL DEFAULT 0,
        messages            INTEGER NOT NULL DEFAULT 0,
        tool_calls          INTEGER NOT NULL DEFAULT 0,
        input_tokens        INTEGER NOT NULL DEFAULT 0,
        output_tokens       INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens    INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
        total_tokens        INTEGER NOT NULL DEFAULT 0,
        cost_micro_cents    INTEGER NOT NULL DEFAULT 0,
        duration_ms         REAL    NOT NULL DEFAULT 0,
        updated_at          INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_stat_period
        ON analytics_stat(grain, period_key, provider, model);
      CREATE INDEX IF NOT EXISTS idx_analytics_stat_grain_period
        ON analytics_stat(grain, period_key);
      CREATE INDEX IF NOT EXISTS idx_analytics_stat_model
        ON analytics_stat(model, grain, period_key);

      CREATE TABLE IF NOT EXISTS analytics_publish (
        grain              TEXT    NOT NULL,
        period_key         TEXT    NOT NULL,
        published_revision INTEGER NOT NULL,
        published_at       INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_publish_period
        ON analytics_publish(grain, period_key);
    `)
  },
} satisfies DatabaseMigration.Migration
