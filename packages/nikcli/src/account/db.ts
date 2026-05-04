import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { eq } from "drizzle-orm"
import path from "path"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { account, config } from "./account.sql"
import type { AccountRow, ConfigRow } from "./schema"

/** Drizzle's .run() returns void in types but actually returns {changes, lastInsertRowid} at runtime */
type RunResult = { changes: number; lastInsertRowid: number | bigint }
function getChanges(result: void | RunResult): number {
  return (result as RunResult).changes
}

export namespace AccountDB {
  const log = Log.create({ service: "account-db" })

  let _rawDb: Database | undefined
  let _db: ReturnType<typeof drizzle> | undefined

  /**
   * Get the raw bun:sqlite connection (for migration only).
   */
  function rawDb(): Database {
    if (!_rawDb) {
      const dbPath = path.join(Global.Path.data, "accounts.db")
      _rawDb = new Database(dbPath, { create: true })
      _rawDb.exec("PRAGMA journal_mode=WAL;")
      _rawDb.exec("PRAGMA foreign_keys=ON;")
      migrateSchema(_rawDb)
    }
    return _rawDb
  }

  /**
   * Get the Drizzle database instance.
   */
  export function db() {
    if (!_db) {
      _db = drizzle(rawDb(), { schema: { account, config } })
    }
    return _db
  }

  /**
   * Run schema migration on the raw SQLite connection.
   */
  function migrateSchema(database: Database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS account (
        id           TEXT PRIMARY KEY,
        email        TEXT NOT NULL,
        url          TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        token_expiry INTEGER NOT NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config (
        id               INTEGER PRIMARY KEY DEFAULT 1,
        active_account_id TEXT,
        active_org_id    TEXT
      );

      INSERT OR IGNORE INTO config (id) VALUES (1);
    `)
    log.info("database migrated")
  }

  // ============================================================================
  // Config cache — avoids repeated reads of the singleton config row
  // ============================================================================

  let _configCache: { row: ConfigRow; cachedAt: number } | undefined
  const CONFIG_CACHE_TTL = 5_000 // 5 seconds

  function getConfigCached(): ConfigRow {
    const now = Date.now()
    if (_configCache && now - _configCache.cachedAt < CONFIG_CACHE_TTL) {
      return _configCache.row
    }
    const row = db().select().from(config).where(eq(config.id, 1)).get()
    const configRow: ConfigRow = {
      id: row!.id,
      active_account_id: row!.activeAccountId ?? null,
      active_org_id: row!.activeOrgId ?? null,
    }
    _configCache = { row: configRow, cachedAt: now }
    return configRow
  }

  function invalidateConfigCache() {
    _configCache = undefined
  }

  // ============================================================================
  // Account operations
  // ============================================================================

  /** Convert a Drizzle row to the legacy AccountRow type */
  function toAccountRow(row: typeof account.$inferSelect): AccountRow {
    return {
      id: row.id,
      email: row.email,
      url: row.url,
      access_token: row.accessToken,
      refresh_token: row.refreshToken,
      token_expiry: row.tokenExpiry,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  export function getAccount(id: string): AccountRow | undefined {
    const row = db().select().from(account).where(eq(account.id, id)).get()
    return row ? toAccountRow(row) : undefined
  }

  export function listAccounts(): AccountRow[] {
    return db().select().from(account).orderBy(account.id).all().map(toAccountRow)
  }

  export function upsertAccount(row: AccountRow): void {
    db()
      .insert(account)
      .values({
        id: row.id,
        email: row.email,
        url: row.url,
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        tokenExpiry: row.token_expiry,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
      .onConflictDoUpdate({
        target: account.id,
        set: {
          email: row.email,
          url: row.url,
          accessToken: row.access_token,
          refreshToken: row.refresh_token,
          tokenExpiry: row.token_expiry,
          updatedAt: row.updated_at,
        },
      })
      .run()
  }

  /**
   * Persist only the token fields — does NOT overwrite email, url, or created_at.
   * This fixes the critical bug where upsertAccount with blank fields destroyed user data.
   */
  export function persistToken(id: string, accessToken: string, refreshToken: string, expiresIn: number): void {
    const now = Date.now()
    db()
      .update(account)
      .set({
        accessToken,
        refreshToken,
        tokenExpiry: now + expiresIn * 1000,
        updatedAt: now,
      })
      .where(eq(account.id, id))
      .run()
  }

  export function deleteAccount(id: string): boolean {
    const result = db().delete(account).where(eq(account.id, id)).run()
    return getChanges(result) > 0
  }

  // ============================================================================
  // Config operations
  // ============================================================================

  export function getConfig(): ConfigRow {
    return getConfigCached()
  }

  export function setActiveAccount(accountId: string | null): void {
    db().update(config).set({ activeAccountId: accountId }).where(eq(config.id, 1)).run()
    invalidateConfigCache()
  }

  export function setActiveOrg(orgId: string | null): void {
    db().update(config).set({ activeOrgId: orgId }).where(eq(config.id, 1)).run()
    invalidateConfigCache()
  }

  /**
   * Get the active account ID (uses cached config).
   */
  export function getActiveAccountId(): string | undefined {
    return getConfigCached().active_account_id ?? undefined
  }

  /**
   * Get the active org ID (uses cached config).
   */
  export function getActiveOrgId(): string | undefined {
    return getConfigCached().active_org_id ?? undefined
  }
}
