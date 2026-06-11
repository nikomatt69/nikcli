import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// ============================================================================
// Permission Rulesets — SQL backend for JSON-backed permission storage
// ============================================================================

export const permissionRuleset = sqliteTable("permission_ruleset", {
  /** Project ID — one ruleset per project */
  projectId: text("project_id").primaryKey(),
  /** JSON array of PermissionNext.Rule items */
  rules: text("rules").notNull().default("[]"),
});
