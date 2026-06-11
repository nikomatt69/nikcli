import { eq } from "drizzle-orm";
import { Database } from "@/database/database";
import { permissionRuleset } from "./permission.sql";
import type { PermissionNext } from "./next";

/**
 * SQL-backed repository for Permission data.
 * Provides synchronous CRUD operations against the central nikcli.db.
 */
export namespace PermissionRepo {
  function db() {
    return Database.syncDb();
  }

  export function get(projectId: string): PermissionNext.Ruleset {
    const row = db()
      .select()
      .from(permissionRuleset)
      .where(eq(permissionRuleset.projectId, projectId))
      .get();
    if (!row) return [];
    try {
      return JSON.parse(row.rules) as PermissionNext.Ruleset;
    } catch {
      return [];
    }
  }

  export function upsert(
    projectId: string,
    rules: PermissionNext.Ruleset,
  ): void {
    db()
      .insert(permissionRuleset)
      .values({
        projectId,
        rules: JSON.stringify(rules),
      })
      .onConflictDoUpdate({
        target: permissionRuleset.projectId,
        set: {
          rules: JSON.stringify(rules),
        },
      })
      .run();
  }

  export function remove(projectId: string): boolean {
    const result = db()
      .delete(permissionRuleset)
      .where(eq(permissionRuleset.projectId, projectId))
      .run();
    return (result as any).changes > 0;
  }
}
