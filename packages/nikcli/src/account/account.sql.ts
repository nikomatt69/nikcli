import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

// ============================================================================
// Account
// ============================================================================

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  url: text("url").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenExpiry: integer("token_expiry").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

// ============================================================================
// Config
// ============================================================================

export const config = sqliteTable("config", {
  id: integer("id").primaryKey().default(1),
  activeAccountId: text("active_account_id"),
  activeOrgId: text("active_org_id"),
})
