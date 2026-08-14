import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core"

// ============================================================================
// Analytics rollups — the anonymous, publishable view of local usage
// ============================================================================

/**
 * Pre-aggregated usage, one row per (grain, period, provider, model).
 *
 * Modelled on opencode's `model_stat`: the published surface reads rollups, never
 * raw rows. Two reasons that shape matters here.
 *
 * Nothing identifying can leak by accident. `message_info` holds whole serialized
 * messages — prompts, paths, titles. A publisher that queries it has to remember
 * to strip all of that on every query. This table simply has nowhere to put it:
 * the only text columns are provider and model.
 *
 * Distinct counts have to be computed where the identities still exist. `sessions`
 * is counted while rolling up, because a session spanning two models cannot be
 * recovered by summing per-model rows afterwards — it would count twice. The same
 * rule applies to distinct installs on the server that receives these rows, which
 * is why an install count is not derivable from what we publish and must be
 * counted at ingest.
 */
export const analyticsStat = sqliteTable(
  "analytics_stat",
  {
    /** Bucket size: currently only `day`. Week/month rollups slot in here. */
    grain: text("grain").notNull(),
    /** `YYYY-MM-DD` for day grain. UTC, so installs in different zones align. */
    periodKey: text("period_key").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),

    /** Distinct sessions touching this model in the period — counted, never summed. */
    sessions: integer("sessions").notNull().default(0),
    /** Assistant messages, i.e. completions. */
    messages: integer("messages").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),

    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** Every bucket above, so a tokens total matches what the model was billed for. */
    totalTokens: integer("total_tokens").notNull().default(0),

    /**
     * Micro-cents, matching the gateway's `usage.cost`. Integers because summing
     * a per-message float cost across a year drifts.
     */
    costMicroCents: integer("cost_micro_cents").notNull().default(0),

    /** Wall-clock of the assistant turns, for a tokens-per-second read. */
    durationMs: real("duration_ms").notNull().default(0),

    /** When this rollup was last recomputed; a day can be recomputed until it is sent. */
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    periodIdx: uniqueIndex("idx_analytics_stat_period").on(table.grain, table.periodKey, table.provider, table.model),
    // Serves the "everything since X" scan the publisher runs.
    grainPeriodIdx: index("idx_analytics_stat_grain_period").on(table.grain, table.periodKey),
    modelIdx: index("idx_analytics_stat_model").on(table.model, table.grain, table.periodKey),
  }),
)

/**
 * The local install UUID for anonymous reporting.
 *
 * One row (`id = 'local'`). Replaces `["analytics","share-state"]`. The
 * published-period cursor already lives on {@link analyticsPublish}; this
 * table only has to remember the identifier the collector keys replacements
 * on.
 */
export const analyticsShare = sqliteTable("analytics_share", {
  id: text("id").primaryKey(),
  installId: text("install_id").notNull(),
  createdAt: integer("created_at").notNull(),
})

/**
 * What has already been published, so a period is sent once and only resent when
 * it is recomputed. Kept separate from {@link analyticsStat} so clearing the
 * publish history never risks deleting the usage itself.
 */
export const analyticsPublish = sqliteTable(
  "analytics_publish",
  {
    grain: text("grain").notNull(),
    periodKey: text("period_key").notNull(),
    /** `updatedAt` of the rollup at the time it was accepted. */
    publishedRevision: integer("published_revision").notNull(),
    publishedAt: integer("published_at").notNull(),
  },
  (table) => ({
    periodIdx: uniqueIndex("idx_analytics_publish_period").on(table.grain, table.periodKey),
  }),
)
