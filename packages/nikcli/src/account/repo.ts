import { AccountDB } from "./db"
import { normalizeServerUrl } from "./url"
import type { AccountRow, Info, Org, RefreshToken } from "./schema"

export namespace AccountRepo {
  // ============================================================================
  // Token persistence
  // ============================================================================

  /**
   * Persist updated tokens for an account
   */
  export function persistToken(
    accountId: string,
    accessToken: string,
    refreshToken: RefreshToken,
    expiresIn: number,
  ): void {
    AccountDB.persistToken(accountId, accessToken, refreshToken, expiresIn)
  }

  // ============================================================================
  // Account CRUD
  // ============================================================================

  /**
   * Get an account row by ID
   */
  export function getRow(accountId: string): AccountRow | undefined {
    return AccountDB.getAccount(accountId)
  }

  /**
   * Get account info (without tokens)
   */
  export function get(accountId: string): Info | undefined {
    const row = getRow(accountId)
    if (!row) return undefined

    return {
      id: accountId as Info["id"],
      email: row.email,
      url: row.url,
      active_org_id: AccountDB.getActiveOrgId() as Info["active_org_id"],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  /**
   * List all accounts
   */
  export function list(): Info[] {
    const rows = AccountDB.listAccounts()
    const activeOrgId = AccountDB.getActiveOrgId()
    return rows.map((row) => ({
      id: row.id as Info["id"],
      email: row.email,
      url: row.url,
      active_org_id: activeOrgId as Info["active_org_id"],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  }

  /**
   * Persist a full account (used after successful login)
   */
  export function persistAccount(
    accountId: string,
    email: string,
    serverUrl: string,
    accessToken: string,
    refreshToken: RefreshToken,
    expiresIn: number,
  ): void {
    const now = Date.now()
    AccountDB.upsertAccount({
      id: accountId,
      email,
      url: normalizeServerUrl(serverUrl),
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expiry: now + expiresIn * 1000,
      created_at: now,
      updated_at: now,
    })

    // Set as active account
    AccountDB.setActiveAccount(accountId)
  }

  /**
   * Remove an account
   */
  export function remove(accountId: string): boolean {
    const deleted = AccountDB.deleteAccount(accountId)
    if (deleted) {
      // If this was the active account, clear it
      if (AccountDB.getActiveAccountId() === accountId) {
        AccountDB.setActiveAccount(null)
        AccountDB.setActiveOrg(null)
      }
    }
    return deleted
  }

  // ============================================================================
  // Active account
  // ============================================================================

  /**
   * Get the active account info
   */
  export function active(): Info | undefined {
    const activeId = AccountDB.getActiveAccountId()
    if (!activeId) return undefined
    return get(activeId)
  }

  /**
   * Set the active account
   */
  export function use(accountId: string | null, orgId?: string | null): void {
    AccountDB.setActiveAccount(accountId)
    AccountDB.setActiveOrg(orgId ?? null)
  }
}
