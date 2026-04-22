import { Database } from "bun:sqlite"
import path from "path"
import { Global } from "@/global"
import { Log } from "@/util/log"
import type { AccountRow, ConfigRow } from "./schema"

export namespace AccountDB {
  const log = Log.create({ service: "account-db" })

  let _db: Database | undefined

  /**
   * Get the database connection (singleton)
   */
  export function db(): Database {
    if (!_db) {
      const dbPath = path.join(Global.Path.data, "accounts.db")
      _db = new Database(dbPath, { create: true })
      _db.exec("PRAGMA journal_mode=WAL;")
      _db.exec("PRAGMA foreign_keys=ON;")
      migrate(_db)
    }
    return _db
  }

  /**
   * Initialize schema
   */
  function migrate(database: Database) {
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
  // Prepared statements (cached)
  // ============================================================================

  let _stmts: typeof stmts | undefined

  function getStatements() {
    if (!_stmts) {
      _stmts = {
        getAccount: db().prepare("SELECT * FROM account WHERE id = ?"),
        listAccounts: db().prepare("SELECT * FROM account ORDER BY id ASC"),
        upsertAccount: db().prepare(`
          INSERT INTO account (id, email, url, access_token, refresh_token, token_expiry, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            url = excluded.url,
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            token_expiry = excluded.token_expiry,
            updated_at = excluded.updated_at
        `),
        deleteAccount: db().prepare("DELETE FROM account WHERE id = ?"),
        getConfig: db().prepare("SELECT * FROM config WHERE id = 1"),
        setActiveAccount: db().prepare("UPDATE config SET active_account_id = ? WHERE id = 1"),
        setActiveOrg: db().prepare("UPDATE config SET active_org_id = ? WHERE id = 1"),
      }
    }
    return _stmts!
  }

  const stmts = {
    get getAccount() { return getStatements().getAccount },
    get listAccounts() { return getStatements().listAccounts },
    get upsertAccount() { return getStatements().upsertAccount },
    get deleteAccount() { return getStatements().deleteAccount },
    get getConfig() { return getStatements().getConfig },
    get setActiveAccount() { return getStatements().setActiveAccount },
    get setActiveOrg() { return getStatements().setActiveOrg },
  }

  // ============================================================================
  // Account operations
  // ============================================================================

  export function getAccount(id: string): AccountRow | undefined {
    return stmts.getAccount.get(id) as AccountRow | undefined
  }

  export function listAccounts(): AccountRow[] {
    return stmts.listAccounts.all() as AccountRow[]
  }

  export function upsertAccount(row: AccountRow): void {
    stmts.upsertAccount.run(
      row.id,
      row.email,
      row.url,
      row.access_token,
      row.refresh_token,
      row.token_expiry,
      row.created_at,
      row.updated_at,
    )
  }

  export function deleteAccount(id: string): boolean {
    const result = stmts.deleteAccount.run(id)
    return result.changes > 0
  }

  export function persistToken(id: string, accessToken: string, refreshToken: string, expiresIn: number): void {
    const now = Date.now()
    upsertAccount({
      id,
      email: "",
      url: "",
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expiry: now + expiresIn * 1000,
      created_at: 0,
      updated_at: now,
    })
  }

  // ============================================================================
  // Config operations
  // ============================================================================

  export function getConfig(): ConfigRow {
    return stmts.getConfig.get() as ConfigRow
  }

  export function setActiveAccount(accountId: string | null): void {
    stmts.setActiveAccount.run(accountId)
  }

  export function setActiveOrg(orgId: string | null): void {
    stmts.setActiveOrg.run(orgId)
  }

  /**
   * Get the active account ID
   */
  export function getActiveAccountId(): string | undefined {
    const config = getConfig()
    return config.active_account_id ?? undefined
  }

  /**
   * Get the active org ID
   */
  export function getActiveOrgId(): string | undefined {
    const config = getConfig()
    return config.active_org_id ?? undefined
  }
}
