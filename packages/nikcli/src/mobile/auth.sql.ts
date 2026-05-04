import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

// ============================================================================
// Mobile Auth Tokens
// ============================================================================

export const mobileTokens = sqliteTable("mobile_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  expiresAt: integer("expires_at"),
})
