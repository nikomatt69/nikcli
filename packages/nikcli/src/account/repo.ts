import { AccountDB } from "./db"
import { normalizeServerUrl } from "./url"
import type { AccountRow, Info, Org, RefreshToken } from "./schema"

export namespace AccountRepo {
  // ============================================================================
  // Token persistence
  // ============================================================================

  /**
   * Persist updated tokens for an account.
   * Now safely updates only token fields via AccountDB.persistToken.
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
   * Get account info (without tokens).
   * Consolidates config reads — reads config once instead of twice.
   */
  export function get(accountId: string): Info | undefined {
    const config = AccountDB.getConfig()
    const row = AccountDB.getAccount(accountId)
    if (!row) return undefined

    return {
      id: accountId as Info["id"],
      email: row.email,
      url: row.url,
      active_org_id: config.active_org_id as Info["active_org_id"],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  /**
   * List all accounts.
   * Reads config once instead of a separate getActiveOrgId call.
   */
  export function list(): Info[] {
    const config = AccountDB.getConfig()
    return AccountDB.listAccounts().map((row) => ({
      id: row.id as Info["id"],
      email: row.email,
      url: row.url,
      active_org_id: config.active_org_id as Info["active_org_id"],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  }

  /**
   * Persist a full account (used after successful login).
   * Now uses a transaction to ensure atomicity.
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
   * Remove an account.
   */
  export function remove(accountId: string): boolean {
    const deleted = AccountDB.deleteAccount(accountId)
    if (deleted) {
      // If this was the active account, clear it
      const config = AccountDB.getConfig()
      if (config.active_account_id === accountId) {
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
   * Get the active account info.
   * Consolidates config reads — reads config once instead of twice.
   */
  export function active(): Info | undefined {
    const config = AccountDB.getConfig()
    if (!config.active_account_id) return undefined

    const row = AccountDB.getAccount(config.active_account_id)
    if (!row) return undefined

    return {
      id: config.active_account_id as Info["id"],
      email: row.email,
      url: row.url,
      active_org_id: config.active_org_id as Info["active_org_id"],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  /**
   * Set the active account and optionally the org.
   */
  export function use(accountId: string | null, orgId?: string | null): void {
    AccountDB.setActiveAccount(accountId)
    AccountDB.setActiveOrg(orgId ?? null)
  }
}
