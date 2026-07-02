import { eq } from "drizzle-orm"
import { createHash, randomBytes } from "node:crypto"
import z from "zod"
import { Global } from "@/global"
import { Database } from "@/database/database"
import { mobileTokens } from "./auth.sql"

/** Drizzle's .run() returns void in types but actually returns {changes, lastInsertRowid} at runtime */
type RunResult = { changes: number; lastInsertRowid: number | bigint }
function getChanges(result: void | RunResult): number {
  return (result as RunResult).changes
}

export namespace MobileAuth {
  /**
   * Token scope: `mobile` (paired mobile device), `cli-sync` (CLI↔hub sync),
   * `studio` (desktop UI). The `/sync/*` routes require `cli-sync` or
   * `studio` when a bearer token is used.
   */
  export const Scope = z.enum(["mobile", "cli-sync", "studio"])
  export type Scope = z.infer<typeof Scope>

  export const Token = z
    .object({
      id: z.string(),
      name: z.string(),
      hash: z.string(),
      createdAt: z.number(),
      lastUsedAt: z.number().optional(),
      expiresAt: z.number().optional(),
      scope: z.string().default("mobile"),
    })
    .meta({ ref: "MobileAuthToken" })

  export const PublicToken = Token.omit({ hash: true }).meta({
    ref: "MobileAuthTokenPublic",
  })

  export type Token = z.infer<typeof Token>
  export type PublicToken = z.infer<typeof PublicToken>

  // ============================================================================
  // Database access — uses the shared central Database.Service
  // ============================================================================

  function db() {
    return Database.syncDb()
  }

  // ============================================================================
  // In-memory cache — eliminates DB reads on every authenticated request
  // ============================================================================

  const tokenCache = new Map<string, { token: PublicToken; expiresAt: number | undefined; cachedAt: number }>()
  const TOKEN_CACHE_TTL = 60_000 // 1 minute

  /** Minimum interval between lastUsedAt writes (5 minutes) */
  const LAST_USED_WRITE_INTERVAL = 300_000

  function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex")
  }

  function invalidateCache() {
    tokenCache.clear()
  }

  // ============================================================================
  // Internal: Drizzle row → Token conversion
  // ============================================================================

  function toToken(row: typeof mobileTokens.$inferSelect): Token {
    return {
      id: row.id,
      name: row.name,
      hash: row.hash,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      scope: row.scope ?? "mobile",
    }
  }

  function toPublicToken(row: typeof mobileTokens.$inferSelect): PublicToken {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      scope: row.scope ?? "mobile",
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Migrate existing mobile-auth.json into SQLite.
   * Safe to call on every startup — skips if JSON file doesn't exist.
   */
  async function migrateFromJson(): Promise<void> {
    const jsonPath = (await import("path")).join(Global.Path.data, "mobile-auth.json")
    const file = Bun.file(jsonPath)

    if (!(await file.exists())) return

    try {
      const data = await file.json().catch(() => [])
      const parsed = z.array(Token).safeParse(data)
      if (!parsed.success) return

      for (const token of parsed.data) {
        db()
          .insert(mobileTokens)
          .values({
            id: token.id,
            name: token.name,
            hash: token.hash,
            createdAt: token.createdAt,
            lastUsedAt: token.lastUsedAt ?? null,
            expiresAt: token.expiresAt ?? null,
          })
          .onConflictDoNothing()
          .run()
      }

      // Remove the old JSON file after successful migration
      const { unlink } = await import("fs/promises")
      await unlink(jsonPath).catch(() => undefined)
    } catch {
      // Silently skip migration on any error
    }
  }

  // Run migration on first DB access
  let _migrated = false
  async function ensureMigrated() {
    if (!_migrated) {
      _migrated = true
      await migrateFromJson()
    }
  }

  export async function all(): Promise<Token[]> {
    await ensureMigrated()
    const rows = db().select().from(mobileTokens).all()
    return rows.map(toToken)
  }

  export async function list(): Promise<PublicToken[]> {
    const tokens = await all()
    const now = Date.now()
    return tokens
      .filter((item) => !item.expiresAt || item.expiresAt > now)
      .map((item) => PublicToken.parse(item))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  export async function create(input?: { name?: string; expiresInDays?: number; scope?: Scope }) {
    await ensureMigrated()
    const token = `nkm_${randomBytes(24).toString("base64url")}`
    const info: typeof mobileTokens.$inferInsert = {
      id: `mat_${randomBytes(8).toString("hex")}`,
      name: input?.name?.trim() || "mobile-app",
      hash: hashToken(token),
      createdAt: Date.now(),
      lastUsedAt: null,
      expiresAt: input?.expiresInDays ? Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000 : null,
      scope: input?.scope ?? "mobile",
    }

    db().insert(mobileTokens).values(info).run()

    invalidateCache()

    return {
      token,
      info: PublicToken.parse({
        id: info.id,
        name: info.name,
        createdAt: info.createdAt,
        lastUsedAt: info.lastUsedAt ?? undefined,
        expiresAt: info.expiresAt ?? undefined,
        scope: info.scope,
      }),
    }
  }

  export async function remove(id: string) {
    await ensureMigrated()
    invalidateCache()
    const result = db().delete(mobileTokens).where(eq(mobileTokens.id, id)).run()
    return getChanges(result) > 0
  }

  /**
   * Verify a bearer token.
   * Uses in-memory cache to avoid DB reads on every authenticated request.
   */
  export async function verify(token: string): Promise<PublicToken | undefined> {
    await ensureMigrated()
    const hashed = hashToken(token)
    const now = Date.now()

    // Check cache first
    const cached = tokenCache.get(hashed)
    if (cached) {
      if (now - cached.cachedAt < TOKEN_CACHE_TTL) {
        // Still within TTL
        if (!cached.expiresAt || cached.expiresAt > now) {
          return cached.token
        }
        // Token expired
        tokenCache.delete(hashed)
        return undefined
      }
      // TTL expired — fall through to DB
      tokenCache.delete(hashed)
    }

    // Cache miss — query SQLite
    const row = db().select().from(mobileTokens).where(eq(mobileTokens.hash, hashed)).get()
    if (!row) return undefined

    if (row.expiresAt !== null && row.expiresAt <= now) return undefined

    // Debounced lastUsedAt update — only write if >5 minutes since last write
    if (!row.lastUsedAt || now - row.lastUsedAt > LAST_USED_WRITE_INTERVAL) {
      db().update(mobileTokens).set({ lastUsedAt: now }).where(eq(mobileTokens.id, row.id)).run()
    }

    const publicToken = toPublicToken(row)

    // Populate cache
    tokenCache.set(hashed, {
      token: publicToken,
      expiresAt: row.expiresAt ?? undefined,
      cachedAt: now,
    })

    return publicToken
  }

  export function bearer(request: Request): string | undefined {
    const header = request.headers.get("authorization") || request.headers.get("Authorization")
    if (!header) return
    const [scheme, value] = header.split(/\s+/, 2)
    if (!scheme || !value) return
    if (scheme.toLowerCase() !== "bearer") return
    return value.trim()
  }
}
