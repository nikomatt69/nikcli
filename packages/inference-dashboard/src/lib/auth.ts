import * as bcrypt from "bcryptjs"
import type { APIContext, AstroCookies } from "astro"
import { getEnv, type RuntimeEnv } from "./env"

export interface AuthUser {
  id: string
  email: string
  name: string | null
  plan: string
  createdAt: number
}

const SESSION_COOKIE = "nik_session"
const SESSION_TTL_SEC = 60 * 60 * 24 * 30 // 30 days

function randomId(byteLen = 24): string {
  const buf = new Uint8Array(byteLen)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

export async function createUser(env: RuntimeEnv, input: { email: string; password: string; name?: string }): Promise<AuthUser> {
  const email = input.email.toLowerCase().trim()
  if (!email.includes("@")) throw new AuthError("Invalid email", 400)
  if (input.password.length < 8) throw new AuthError("Password must be at least 8 characters", 400)

  const existing = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()
  if (existing) throw new AuthError("Email already registered", 409)

  const id = randomId(16)
  const hash = await bcrypt.hash(input.password, 10)
  const ts = nowSec()
  await env.DB.prepare(
    "INSERT INTO users (id, email, name, password_hash, plan, created_at, updated_at) VALUES (?, ?, ?, ?, 'free', ?, ?)",
  )
    .bind(id, email, input.name?.trim() ?? null, hash, ts, ts)
    .run()

  return { id, email, name: input.name?.trim() ?? null, plan: "free", createdAt: ts }
}

export async function verifyCredentials(
  env: RuntimeEnv,
  input: { email: string; password: string },
): Promise<AuthUser> {
  const email = input.email.toLowerCase().trim()
  const row = await env.DB.prepare(
    "SELECT id, email, name, plan, password_hash, created_at FROM users WHERE email = ?",
  )
    .bind(email)
    .first<{ id: string; email: string; name: string | null; plan: string; password_hash: string; created_at: number }>()
  if (!row) throw new AuthError("Invalid email or password", 401)
  const ok = await bcrypt.compare(input.password, row.password_hash)
  if (!ok) throw new AuthError("Invalid email or password", 401)
  return { id: row.id, email: row.email, name: row.name, plan: row.plan, createdAt: row.created_at }
}

export async function createSession(
  env: RuntimeEnv,
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<string> {
  const sessionId = randomId(32)
  const expiresAt = nowSec() + SESSION_TTL_SEC
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, user_agent, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(sessionId, userId, expiresAt, meta.userAgent ?? null, meta.ip ?? null, nowSec())
    .run()
  return sessionId
}

export async function destroySession(env: RuntimeEnv, sessionId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run()
}

export async function getSessionUser(env: RuntimeEnv, sessionId: string | undefined): Promise<AuthUser | null> {
  if (!sessionId) return null
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.plan, u.created_at, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? LIMIT 1`,
  )
    .bind(sessionId)
    .first<{ id: string; email: string; name: string | null; plan: string; created_at: number; expires_at: number }>()
  if (!row) return null
  if (row.expires_at < nowSec()) {
    await destroySession(env, sessionId)
    return null
  }
  return { id: row.id, email: row.email, name: row.name, plan: row.plan, createdAt: row.created_at }
}

export function setSessionCookie(cookies: AstroCookies, sessionId: string) {
  cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  })
}

export function clearSessionCookie(cookies: AstroCookies) {
  cookies.delete(SESSION_COOKIE, { path: "/" })
}

export function readSessionCookie(cookies: AstroCookies): string | undefined {
  return cookies.get(SESSION_COOKIE)?.value
}

export async function getCurrentUser(ctx: APIContext): Promise<AuthUser | null> {
  const env = getEnv(ctx)
  const sessionId = readSessionCookie(ctx.cookies)
  return getSessionUser(env, sessionId)
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = "AuthError"
  }
}
