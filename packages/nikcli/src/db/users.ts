import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { eq, and, or, sql, desc, asc } from "drizzle-orm"
import { createHash, randomBytes } from "node:crypto"
import fs from "fs/promises"
import { readFileSync } from "fs"
import path from "path"
import { Global } from "@/global"
import { users, userSessions, chatContacts, chatMessages } from "./users.sql"

/** Drizzle's .run() returns void in types but actually returns {changes, lastInsertRowid} at runtime */
type RunResult = { changes: number; lastInsertRowid: number | bigint }
function getChanges(result: void | RunResult): number {
  return (result as RunResult).changes
}

export namespace UserDB {
  // ============================================================================
  // Admin email allowlist — only these emails can hold the "admin" role
  // ============================================================================

  const ADMIN_EMAILS = new Set(["nicom.19@icloud.com", "nicola.mattioli.95@gmail.com"])

  /**
   * Check if an email address is allowed to hold the admin role.
   * This is the single source of truth for admin eligibility.
   */
  export function isAdminEmail(email: string): boolean {
    return ADMIN_EMAILS.has(email.trim().toLowerCase())
  }

  /**
   * Get the list of admin-eligible email addresses.
   * Useful for UI hints and validation messages.
   */
  export function getAdminEmails(): string[] {
    return [...ADMIN_EMAILS]
  }

  // ============================================================================
  // Types — keep the same public API shape for backwards compatibility
  // ============================================================================

  export type User = {
    id: string
    username: string
    email: string
    password_hash: string
    display_name: string | null
    role: "admin" | "user"
    created_at: number
    updated_at: number
  }

  export type PublicUser = Omit<User, "password_hash">

  export type Session = {
    id: string
    user_id: string
    token_hash: string
    expires_at: number | null
    created_at: number
  }

  export type ChatMessage = {
    id: string
    sender_id: string
    receiver_id: string
    content: string
    read: number
    created_at: number
  }

  // ============================================================================
  // Database connection (lazy singleton)
  // ============================================================================

  let _rawDb: Database | undefined
  let _drizzle: ReturnType<typeof drizzle> | undefined

  /**
   * Get the raw bun:sqlite connection (for migration only).
   * All queries should go through `db()` which returns the Drizzle instance.
   */
  function rawDb(): Database {
    if (!_rawDb) {
      const p = path.join(Global.Path.data, "users.db")
      _rawDb = new Database(p, { create: true })
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
    if (!_drizzle) {
      _drizzle = drizzle(rawDb(), { schema: { users, userSessions, chatContacts, chatMessages } })
    }
    return _drizzle
  }

  /**
   * Run schema migration on the raw SQLite connection.
   * Uses CREATE TABLE IF NOT EXISTS for backward compatibility with existing databases.
   */
  function migrateSchema(database: Database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id           TEXT PRIMARY KEY,
        username     TEXT UNIQUE NOT NULL,
        email        TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        role         TEXT NOT NULL DEFAULT 'user',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  TEXT NOT NULL UNIQUE,
        expires_at  INTEGER,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);

      CREATE TABLE IF NOT EXISTS chat_contacts (
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contact_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (user_id, contact_id)
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id          TEXT PRIMARY KEY,
        sender_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content     TEXT NOT NULL,
        read        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
        ON chat_messages(sender_id, receiver_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_receiver
        ON chat_messages(receiver_id, read);
      CREATE INDEX IF NOT EXISTS idx_users_created_at
        ON users(created_at);
    `)
  }

  // ============================================================================
  // Session cache — eliminates SHA-256 + 2 DB queries on every authenticated request
  // ============================================================================

  const sessionCache = new Map<string, { user: PublicUser; expiresAt: number | null; cachedAt: number }>()
  const SESSION_CACHE_TTL = 60_000 // 1 minute

  /**
   * Invalidate session cache entries.
   * Call when sessions are revoked or users are modified.
   */
  function invalidateSessionCache(hash?: string, userId?: string) {
    if (hash) sessionCache.delete(hash)
    if (userId) {
      for (const [key, val] of sessionCache) {
        if (val.user.id === userId) sessionCache.delete(key)
      }
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex")
  }

  function generateId(prefix: string): string {
    return `${prefix}_${randomBytes(12).toString("hex")}`
  }

  /** Convert a Drizzle row to the legacy PublicUser type */
  function rowToPublic(row: typeof users.$inferSelect): PublicUser {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      display_name: row.displayName,
      role: row.role as "admin" | "user",
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  /** Convert a Drizzle row to the legacy User type */
  function rowToUser(row: typeof users.$inferSelect): User {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      password_hash: row.passwordHash,
      display_name: row.displayName,
      role: row.role as "admin" | "user",
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  /**
   * Public utility to convert a User to PublicUser (strips password_hash).
   * Kept for backward compatibility with consumers.
   */
  export function toPublic(user: User): PublicUser {
    const { password_hash: _, ...pub } = user
    return pub as PublicUser
  }

  // ============================================================================
  // User CRUD
  // ============================================================================

  export async function create(input: {
    username: string
    email: string
    password: string
    displayName?: string
    role?: "admin" | "user"
  }): Promise<PublicUser> {
    const normalizedEmail = input.email.trim().toLowerCase()

    // Determine role: explicit override takes precedence, then email allowlist, then fallback
    let role: "admin" | "user"
    if (input.role) {
      // Explicit role requested — enforce admin allowlist
      if (input.role === "admin" && !isAdminEmail(normalizedEmail)) {
        throw new Error("This email address is not authorized to hold the admin role")
      }
      role = input.role
    } else if (!hasUsers()) {
      // No users exist yet — grant admin only if email is in the allowlist
      role = isAdminEmail(normalizedEmail) ? "admin" : "user"
    } else {
      role = "user"
    }

    const hash = await Bun.password.hash(input.password, { algorithm: "bcrypt", cost: 10 })
    const now = Date.now()
    const id = generateId("usr")

    db()
      .insert(users)
      .values({
        id,
        username: input.username.trim(),
        email: input.email.trim().toLowerCase(),
        passwordHash: hash,
        displayName: input.displayName?.trim() ?? null,
        role,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const row = db().select().from(users).where(eq(users.id, id)).get()
    return row
      ? rowToPublic(row)
      : {
          id,
          username: input.username.trim(),
          email: input.email.trim().toLowerCase(),
          display_name: input.displayName?.trim() ?? null,
          role,
          created_at: now,
          updated_at: now,
        }
  }

  export function findByEmail(email: string): User | null {
    const row = db().select().from(users).where(eq(users.email, email.toLowerCase())).get()
    return row ? rowToUser(row) : null
  }

  export function findById(id: string): User | null {
    const row = db().select().from(users).where(eq(users.id, id)).get()
    return row ? rowToUser(row) : null
  }

  export async function verifyPassword(user: User, password: string): Promise<boolean> {
    return Bun.password.verify(password, user.password_hash)
  }

  export function createSession(userId: string, expiresInDays?: number): string {
    const token = `nku_${randomBytes(32).toString("base64url")}`
    const id = generateId("ses")
    const now = Date.now()
    const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null

    db()
      .insert(userSessions)
      .values({
        id,
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        createdAt: now,
      })
      .run()

    return token
  }

  /**
   * Verify a bearer token and return the associated public user.
   * Uses an in-memory cache to avoid hitting the database on every request.
   */
  export function verifySession(rawToken: string): PublicUser | null {
    if (!rawToken.startsWith("nku_")) return null
    const hash = hashToken(rawToken)
    const now = Date.now()

    // Check cache first
    const cached = sessionCache.get(hash)
    if (cached) {
      if (now - cached.cachedAt < SESSION_CACHE_TTL) {
        // Cache entry is still within TTL
        if (cached.expiresAt === null || cached.expiresAt > now) {
          return cached.user
        }
        // Session expired — remove from cache
        sessionCache.delete(hash)
        return null
      }
      // TTL expired — fall through to DB
      sessionCache.delete(hash)
    }

    // Cache miss — use JOIN query (1 query instead of 2)
    const row = db()
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        expiresAt: userSessions.expiresAt,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .where(eq(userSessions.tokenHash, hash))
      .get()

    if (!row) {
      // Token not found
      return null
    }

    if (row.expiresAt !== null && row.expiresAt <= now) {
      // Session expired — delete and return null
      db().delete(userSessions).where(eq(userSessions.tokenHash, hash)).run()
      sessionCache.delete(hash)
      return null
    }

    const publicUser: PublicUser = {
      id: row.id,
      username: row.username,
      email: row.email,
      display_name: row.displayName,
      role: row.role as "admin" | "user",
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }

    // Populate cache
    sessionCache.set(hash, { user: publicUser, expiresAt: row.expiresAt, cachedAt: now })
    return publicUser
  }

  export function revokeSession(rawToken: string): boolean {
    const hash = hashToken(rawToken)
    invalidateSessionCache(hash)
    const result = db().delete(userSessions).where(eq(userSessions.tokenHash, hash)).run()
    return getChanges(result) > 0
  }

  export function revokeAllUserSessions(userId: string): void {
    invalidateSessionCache(undefined, userId)
    db().delete(userSessions).where(eq(userSessions.userId, userId)).run()
  }

  export function listUsers(): PublicUser[] {
    return db().select().from(users).orderBy(asc(users.createdAt)).all().map(rowToPublic)
  }

  export function hasUsers(): boolean {
    const result = db()
      .select({ exists: sql`exists(select 1 from users)` })
      .from(users)
      .limit(1)
      .get()
    // SQLite returns 1 or 0 for EXISTS
    return (result as any)?.exists ? true : false
  }

  export async function updateUser(
    id: string,
    input: { displayName?: string; password?: string; role?: "admin" | "user" },
  ): Promise<PublicUser | null> {
    const user = findById(id)
    if (!user) return null

    // Enforce admin email allowlist: only allowlisted emails can hold the admin role
    if (input.role === "admin" && !isAdminEmail(user.email)) {
      throw new Error("This email address is not authorized to hold the admin role")
    }

    const updates: Partial<typeof users.$inferInsert> = {}

    if (input.displayName !== undefined) {
      updates.displayName = input.displayName.trim() || null
    }

    if (input.password !== undefined) {
      updates.passwordHash = await Bun.password.hash(input.password, { algorithm: "bcrypt", cost: 10 })
    }

    if (input.role !== undefined) {
      updates.role = input.role
    }

    if (Object.keys(updates).length === 0) return toPublic(user)

    updates.updatedAt = Date.now()

    // Use RETURNING to get updated row in one query instead of read + write + read
    const [updated] = db()
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .all()

    if (!updated) return null

    // Invalidate session cache if role changed
    if (input.role !== undefined) {
      invalidateSessionCache(undefined, id)
    }

    return {
      id: updated.id,
      username: updated.username,
      email: updated.email,
      display_name: updated.displayName,
      role: updated.role as "admin" | "user",
      created_at: updated.createdAt,
      updated_at: updated.updatedAt,
    }
  }

  export function deleteUser(id: string): boolean {
    invalidateSessionCache(undefined, id)
    const result = db().delete(users).where(eq(users.id, id)).run()
    return getChanges(result) > 0
  }

  // ============================================================================
  // Active TUI session persisted to disk
  // ============================================================================

  const SESSION_FILE = path.join(Global.Path.data, "user-session.token")

  export async function getActiveSession(): Promise<string | null> {
    try {
      const token = await Bun.file(SESSION_FILE).text()
      return token.trim() || null
    } catch {
      return null
    }
  }

  export function getActiveSessionSync(): string | null {
    try {
      const token = readFileSync(SESSION_FILE, "utf8").trim()
      return token || null
    } catch {
      return null
    }
  }

  export async function saveActiveSession(token: string): Promise<void> {
    await Bun.write(SESSION_FILE, token)
    // chmod is Unix-only, skip on Windows
    if (process.platform !== "win32") {
      await fs.chmod(SESSION_FILE, 0o600).catch(() => undefined)
    }
  }

  export async function clearActiveSession(): Promise<void> {
    await fs.unlink(SESSION_FILE).catch(() => undefined)
  }

  // ============================================================================
  // Chat — contacts, messages, search
  // ============================================================================

  /**
   * Add a contact bidirectionally (wrapped in a transaction).
   */
  export function addContact(userId: string, contactId: string): void {
    const now = Date.now()
    db().transaction((tx) => {
      tx.insert(chatContacts).values({ userId, contactId, createdAt: now }).onConflictDoNothing().run()
      tx.insert(chatContacts)
        .values({ userId: contactId, contactId: userId, createdAt: now })
        .onConflictDoNothing()
        .run()
    })
  }

  /**
   * Remove a contact bidirectionally (both directions).
   */
  export function removeContact(userId: string, contactId: string): void {
    db()
      .delete(chatContacts)
      .where(
        or(
          and(eq(chatContacts.userId, userId), eq(chatContacts.contactId, contactId)),
          and(eq(chatContacts.userId, contactId), eq(chatContacts.contactId, userId)),
        ),
      )
      .run()
  }

  export function listContacts(userId: string): PublicUser[] {
    const rows = db()
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(chatContacts)
      .innerJoin(users, eq(chatContacts.contactId, users.id))
      .where(eq(chatContacts.userId, userId))
      .orderBy(asc(chatContacts.createdAt))
      .all()

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      display_name: row.displayName,
      role: row.role as "admin" | "user",
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }))
  }

  export function searchUsers(query: string, excludeUserId: string): PublicUser[] {
    const like = `%${query.toLowerCase()}%`
    const rows = db()
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(
        and(
          sql`${users.id} != ${excludeUserId}`,
          or(
            sql`LOWER(${users.username}) LIKE ${like}`,
            sql`LOWER(${users.email}) LIKE ${like}`,
            sql`LOWER(${users.displayName}) LIKE ${like}`,
          ),
        ),
      )
      .limit(10)
      .all()

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      display_name: row.displayName,
      role: row.role as "admin" | "user",
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }))
  }

  export function sendMessage(senderId: string, receiverId: string, content: string): ChatMessage {
    const id = generateId("msg")
    const now = Date.now()
    db()
      .insert(chatMessages)
      .values({
        id,
        senderId,
        receiverId,
        content,
        read: false,
        createdAt: now,
      })
      .run()
    return { id, sender_id: senderId, receiver_id: receiverId, content, read: 0, created_at: now }
  }

  export function getMessages(userId: string, contactId: string, limit = 100): ChatMessage[] {
    // Use a subquery approach with Drizzle for the bidirectional conversation query
    const recentMessages = db()
      .select()
      .from(chatMessages)
      .where(
        or(
          and(eq(chatMessages.senderId, userId), eq(chatMessages.receiverId, contactId)),
          and(eq(chatMessages.senderId, contactId), eq(chatMessages.receiverId, userId)),
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit)
      .as("recent_messages")

    const rows = db().select().from(recentMessages).orderBy(asc(recentMessages.createdAt)).all()

    return rows.map((row) => ({
      id: row.id,
      sender_id: row.senderId,
      receiver_id: row.receiverId,
      content: row.content,
      read: row.read ? 1 : 0,
      created_at: row.createdAt,
    }))
  }

  export function markMessagesRead(userId: string, senderId: string): void {
    db()
      .update(chatMessages)
      .set({ read: true })
      .where(
        and(eq(chatMessages.receiverId, userId), eq(chatMessages.senderId, senderId), eq(chatMessages.read, false)),
      )
      .run()
  }

  export function getUnreadCount(userId: string, senderId: string): number {
    const [result] = db()
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(chatMessages)
      .where(
        and(eq(chatMessages.receiverId, userId), eq(chatMessages.senderId, senderId), eq(chatMessages.read, false)),
      )
      .all()
    return result?.count ?? 0
  }

  export function getTotalUnreadCount(userId: string): number {
    const [result] = db()
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(chatMessages)
      .where(and(eq(chatMessages.receiverId, userId), eq(chatMessages.read, false)))
      .all()
    return result?.count ?? 0
  }
}
