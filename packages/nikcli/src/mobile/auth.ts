import fs from "fs/promises"
import path from "path"
import { createHash, randomBytes } from "node:crypto"
import z from "zod"
import { Global } from "@/global"

export namespace MobileAuth {
  export const Token = z
    .object({
      id: z.string(),
      name: z.string(),
      hash: z.string(),
      createdAt: z.number(),
      lastUsedAt: z.number().optional(),
      expiresAt: z.number().optional(),
    })
    .meta({ ref: "MobileAuthToken" })

  export const PublicToken = Token.omit({ hash: true }).meta({ ref: "MobileAuthTokenPublic" })

  export type Token = z.infer<typeof Token>
  export type PublicToken = z.infer<typeof PublicToken>

  const FILE = path.join(Global.Path.data, "mobile-auth.json")

  function hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex")
  }

  async function write(tokens: Token[]) {
    await Bun.write(Bun.file(FILE), JSON.stringify(tokens, null, 2))
    // chmod is Unix-only, skip on Windows
    if (process.platform !== "win32") {
      await fs.chmod(FILE, 0o600).catch(() => undefined)
    }
  }

  export async function all(): Promise<Token[]> {
    const file = Bun.file(FILE)
    const data = await file.json().catch(() => [])
    const parsed = z.array(Token).safeParse(data)
    if (!parsed.success) return []
    return parsed.data
  }

  export async function list(): Promise<PublicToken[]> {
    const tokens = await all()
    const now = Date.now()
    return tokens
      .filter((item) => !item.expiresAt || item.expiresAt > now)
      .map((item) => PublicToken.parse(item))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  export async function create(input?: { name?: string; expiresInDays?: number }) {
    const token = `nkm_${randomBytes(24).toString("base64url")}`
    const info: Token = {
      id: `mat_${randomBytes(8).toString("hex")}`,
      name: input?.name?.trim() || "mobile-app",
      hash: hashToken(token),
      createdAt: Date.now(),
      expiresAt: input?.expiresInDays ? Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000 : undefined,
    }
    const tokens = await all()
    tokens.push(info)
    await write(tokens)
    return {
      token,
      info: PublicToken.parse(info),
    }
  }

  export async function remove(id: string) {
    const tokens = await all()
    const next = tokens.filter((item) => item.id !== id)
    await write(next)
    return tokens.length !== next.length
  }

  export async function verify(token: string): Promise<PublicToken | undefined> {
    const tokens = await all()
    const hashed = hashToken(token)
    const now = Date.now()
    const match = tokens.find((item) => item.hash === hashed)
    if (!match) return
    if (match.expiresAt && match.expiresAt <= now) return
    match.lastUsedAt = now
    await write(tokens)
    return PublicToken.parse(match)
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
