import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * `usage_events` in the `nikcli-inference` D1 database — one row per completion
 * the inference gateway served, and the table billing reads.
 *
 * The schema is owned by packages/inference-dashboard/d1-migrations (0001_init
 * created it, 0003_oauth_usage made `api_key_id` nullable for OAuth calls); this
 * declaration only mirrors it so the public /data page can query it with the
 * same Drizzle types the rest of the repo uses. Nothing here migrates anything,
 * and the page never writes.
 */
export const UsageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    /** Null for OAuth (identity-token) calls, which carry no API key. */
    apiKeyID: text("api_key_id"),
    userID: text("user_id").notNull(),
    /** Model as the caller asked for it, before routing. */
    model: text("model").notNull(),
    /** Model the router settled on — what the tokens were actually spent on. */
    resolvedModel: text("resolved_model").notNull(),
    /** Upstream that served the call. Null when it was answered from cache. */
    provider: text("provider"),
    upstreamModel: text("upstream_model"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    billedUsd: real("billed_usd").notNull().default(0),
    /** What the upstream cost. Never published — it would publish the margin. */
    upstreamUsd: real("upstream_usd").notNull().default(0),
    savedUsd: real("saved_usd").notNull().default(0),
    /** `hit` or `miss`; null when the gateway reported no cache state. */
    cache: text("cache"),
    rid: text("rid"),
    /** Unix seconds. */
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("usage_key_idx").on(table.apiKeyID),
    index("usage_user_idx").on(table.userID),
    index("usage_created_idx").on(table.createdAt),
  ],
)
