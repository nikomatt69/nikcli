import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "../global"

export namespace ConnectorAuth {
  export const Entry = z.object({
    token: z.string().optional(),
    botToken: z.string().optional(),
    apiKey: z.string().optional(),
    teamId: z.string().optional(),
    expiresAt: z.number().optional(),
  })
  export type Entry = z.infer<typeof Entry>

  const filepath = path.join(Global.Path.data, "connectors-auth.json")

  export async function get(connectorName: string): Promise<Entry | undefined> {
    const data = await all()
    return data[connectorName]
  }

  export async function all(): Promise<Record<string, Entry>> {
    const file = Bun.file(filepath)
    return file.json().catch(() => ({}))
  }

  export async function set(connectorName: string, entry: Entry): Promise<void> {
    const file = Bun.file(filepath)
    const data = await all()
    await Bun.write(file, JSON.stringify({ ...data, [connectorName]: entry }, null, 2))
    // chmod is Unix-only, skip on Windows
    if (process.platform !== "win32") {
      await fs.chmod(file.name!, 0o600)
    }
  }

  export async function remove(connectorName: string): Promise<void> {
    const file = Bun.file(filepath)
    const data = await all()
    delete data[connectorName]
    await Bun.write(file, JSON.stringify(data, null, 2))
    // chmod is Unix-only, skip on Windows
    if (process.platform !== "win32") {
      await fs.chmod(file.name!, 0o600)
    }
  }

  export async function updateToken(connectorName: string, token: string, expiresAt?: number): Promise<void> {
    const entry = (await get(connectorName)) ?? {}
    entry.token = token
    if (expiresAt) entry.expiresAt = expiresAt
    await set(connectorName, entry)
  }

  export async function updateBotToken(connectorName: string, botToken: string, teamId?: string): Promise<void> {
    const entry = (await get(connectorName)) ?? {}
    entry.botToken = botToken
    if (teamId) entry.teamId = teamId
    await set(connectorName, entry)
  }

  export async function updateApiKey(connectorName: string, apiKey: string): Promise<void> {
    const entry = (await get(connectorName)) ?? {}
    entry.apiKey = apiKey
    await set(connectorName, entry)
  }

  export async function isTokenExpired(connectorName: string): Promise<boolean | null> {
    const entry = await get(connectorName)
    if (!entry?.expiresAt) return null
    return entry.expiresAt < Date.now() / 1000
  }
}
