import { Database } from "bun:sqlite"
import { createHash, randomBytes } from "node:crypto"
import fs from "fs/promises"
import { readFileSync } from "fs"
import path from "path"
import { Global } from "@/global"

export namespace UserDB {
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

  let _db: Database | undefined

  export function db(): Database {
    if (!_db) {
      const p = path.join(Global.Path.data, "users.db")
      _db = new Database(p, { create: true })
      _db.exec("PRAGMA journal_mode=WAL;")
      _db.exec("PRAGMA foreign_keys=ON;")
      migrate(_db)
    }
    return _db
  }

  function migrate(database: Database) {
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
    `)
  }

  function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex")
  }

  function generateId(prefix: string): string {
    return `${prefix}_${randomBytes(12).toString("hex")}`
  }

  export function toPublic(user: User): PublicUser {
    const { password_hash: _, ...pub } = user
    return pub as PublicUser
  }

  export async function create(input: {
    username: string
    email: string
    password: string
    displayName?: string
    role?: "admin" | "user"
  }): Promise<PublicUser> {
    const database = db()
    const count = (database.query("SELECT COUNT(*) as count FROM users").get() as { count: number }).count
    const role = input.role ?? (count === 0 ? "admin" : "user")
    const hash = await Bun.password.hash(input.password, { algorithm: "bcrypt", cost: 10 })
    const now = Date.now()
    const id = generateId("usr")

    database.run(
      `INSERT INTO users (id, username, email, password_hash, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.username.trim(),
        input.email.trim().toLowerCase(),
        hash,
        input.displayName?.trim() ?? null,
        role,
        now,
        now,
      ],
    )

    return toPublic(database.query("SELECT * FROM users WHERE id = ?").get(id) as User)
  }

  export function findByEmail(email: string): User | null {
    return db().query("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as User | null
  }

  export function findById(id: string): User | null {
    return db().query("SELECT * FROM users WHERE id = ?").get(id) as User | null
  }

  export async function verifyPassword(user: User, password: string): Promise<boolean> {
    return Bun.password.verify(password, user.password_hash)
  }

  export function createSession(userId: string, expiresInDays?: number): string {
    const token = `nku_${randomBytes(32).toString("base64url")}`
    const id = generateId("ses")
    const now = Date.now()
    const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null

    db().run(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, userId, hashToken(token), expiresAt, now],
    )

    return token
  }

  export function verifySession(rawToken: string): PublicUser | null {
    if (!rawToken.startsWith("nku_")) return null
    const hash = hashToken(rawToken)
    const now = Date.now()

    const session = db().query("SELECT * FROM user_sessions WHERE token_hash = ?").get(hash) as Session | null

    if (!session) return null
    if (session.expires_at && session.expires_at <= now) {
      db().run("DELETE FROM user_sessions WHERE token_hash = ?", [hash])
      return null
    }

    const user = findById(session.user_id)
    if (!user) return null
    return toPublic(user)
  }

  export function revokeSession(rawToken: string): boolean {
    const hash = hashToken(rawToken)
    const result = db().run("DELETE FROM user_sessions WHERE token_hash = ?", [hash])
    return result.changes > 0
  }

  export function revokeAllUserSessions(userId: string): void {
    db().run("DELETE FROM user_sessions WHERE user_id = ?", [userId])
  }

  export function listUsers(): PublicUser[] {
    return (db().query("SELECT * FROM users ORDER BY created_at ASC").all() as User[]).map(toPublic)
  }

  export function hasUsers(): boolean {
    const row = db().query("SELECT COUNT(*) as count FROM users").get() as { count: number }
    return row.count > 0
  }

  export async function updateUser(
    id: string,
    input: { displayName?: string; password?: string; role?: "admin" | "user" },
  ): Promise<PublicUser | null> {
    const user = findById(id)
    if (!user) return null

    const updates: string[] = []
    const values: (string | number | null)[] = []

    if (input.displayName !== undefined) {
      updates.push("display_name = ?")
      values.push(input.displayName.trim() || null)
    }

    if (input.password !== undefined) {
    const hash = await Bun.password.hash(input.password, { algorithm: "bcrypt", cost: 12 })
      updates.push("password_hash = ?")
      values.push(hash)
    }

    if (input.role !== undefined) {
      updates.push("role = ?")
      values.push(input.role)
    }

    if (updates.length === 0) return toPublic(user)

    updates.push("updated_at = ?")
    values.push(Date.now())
    values.push(id)

    db().run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values)

    return toPublic(findById(id)!)
  }

  export function deleteUser(id: string): boolean {
    const result = db().run("DELETE FROM users WHERE id = ?", [id])
    return result.changes > 0
  }

  // --- Active TUI session persisted to disk ---

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
      const file = Bun.file(SESSION_FILE)
      const exists = file.size >= 0
      if (!exists) return null
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

  // --- Chat ---

  export type ChatMessage = {
    id: string
    sender_id: string
    receiver_id: string
    content: string
    read: number
    created_at: number
  }

  export function addContact(userId: string, contactId: string): void {
    db().run(`INSERT OR IGNORE INTO chat_contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)`, [
      userId,
      contactId,
      Date.now(),
    ])
    // Make it symmetric so both sides can see each other
    db().run(`INSERT OR IGNORE INTO chat_contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)`, [
      contactId,
      userId,
      Date.now(),
    ])
  }

  export function removeContact(userId: string, contactId: string): void {
    db().run(`DELETE FROM chat_contacts WHERE user_id = ? AND contact_id = ?`, [userId, contactId])
  }

  export function listContacts(userId: string): PublicUser[] {
    return db()
      .query(
        `SELECT u.id, u.username, u.email, u.display_name, u.role, u.created_at, u.updated_at
           FROM chat_contacts cc
           JOIN users u ON u.id = cc.contact_id
           WHERE cc.user_id = ?
           ORDER BY cc.created_at ASC`,
      )
      .all(userId) as PublicUser[]
  }

  export function searchUsers(query: string, excludeUserId: string): PublicUser[] {
    const like = `%${query.toLowerCase()}%`
    return db()
      .query(
        `SELECT id, username, email, display_name, role, created_at, updated_at
           FROM users
           WHERE id != ?
             AND (LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?)
           LIMIT 10`,
      )
      .all(excludeUserId, like, like, like) as PublicUser[]
  }

  export function sendMessage(senderId: string, receiverId: string, content: string): ChatMessage {
    const id = generateId("msg")
    const now = Date.now()
    db().run(
      `INSERT INTO chat_messages (id, sender_id, receiver_id, content, read, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [id, senderId, receiverId, content, now],
    )
    return { id, sender_id: senderId, receiver_id: receiverId, content, read: 0, created_at: now }
  }

  export function getMessages(userId: string, contactId: string, limit = 100): ChatMessage[] {
    return db()
      .query(
        `SELECT * FROM (
           SELECT * FROM chat_messages
           WHERE (sender_id = ? AND receiver_id = ?)
              OR (sender_id = ? AND receiver_id = ?)
           ORDER BY created_at DESC
           LIMIT ?
         ) AS recent_messages
         ORDER BY created_at ASC`,
      )
      .all(userId, contactId, contactId, userId, limit) as ChatMessage[]
  }

  export function markMessagesRead(userId: string, senderId: string): void {
    db().run(
      `UPDATE chat_messages SET read = 1
       WHERE receiver_id = ? AND sender_id = ? AND read = 0`,
      [userId, senderId],
    )
  }

  export function getUnreadCount(userId: string, senderId: string): number {
    const row = db()
      .query(
        `SELECT COUNT(*) as count FROM chat_messages
         WHERE receiver_id = ? AND sender_id = ? AND read = 0`,
      )
      .get(userId, senderId) as { count: number }
    return row?.count ?? 0
  }

  export function getTotalUnreadCount(userId: string): number {
    const row = db()
      .query(`SELECT COUNT(*) as count FROM chat_messages WHERE receiver_id = ? AND read = 0`)
      .get(userId) as { count: number }
    return row?.count ?? 0
  }
}
