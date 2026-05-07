import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "../global"
import { Context, Effect, Layer } from "effect"

export namespace ConnectorAuth {
  export const Entry = z.object({
    token: z.string().optional(),
    botToken: z.string().optional(),
    apiKey: z.string().optional(),
    teamId: z.string().optional(),
    expiresAt: z.number().optional(),
  })
  export type Entry = z.infer<typeof Entry>

  export interface Interface {
    get(connectorName: string): Effect.Effect<Entry | undefined, unknown>
    all(): Effect.Effect<Record<string, Entry>, unknown>
    set(connectorName: string, entry: Entry): Effect.Effect<void, unknown>
    remove(connectorName: string): Effect.Effect<void, unknown>
    updateToken(connectorName: string, token: string, expiresAt?: number): Effect.Effect<void, unknown>
    updateBotToken(connectorName: string, botToken: string, teamId?: string): Effect.Effect<void, unknown>
    updateApiKey(connectorName: string, apiKey: string): Effect.Effect<void, unknown>
    isTokenExpired(connectorName: string): Effect.Effect<boolean | null, unknown>
  }

  export class Service extends Context.Tag("ConnectorAuth.Service")<Service, Interface>() {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      get: (connectorName) => Effect.tryPromise(() => getImpl(connectorName)),
      all: () => Effect.tryPromise(() => allImpl()),
      set: (connectorName, entry) => Effect.tryPromise(() => setImpl(connectorName, entry)),
      remove: (connectorName) => Effect.tryPromise(() => removeImpl(connectorName)),
      updateToken: (connectorName, token, expiresAt) =>
        Effect.tryPromise(() => updateTokenImpl(connectorName, token, expiresAt)),
      updateBotToken: (connectorName, botToken, teamId) =>
        Effect.tryPromise(() => updateBotTokenImpl(connectorName, botToken, teamId)),
      updateApiKey: (connectorName, apiKey) => Effect.tryPromise(() => updateApiKeyImpl(connectorName, apiKey)),
      isTokenExpired: (connectorName) => Effect.tryPromise(() => isTokenExpiredImpl(connectorName)),
    }),
  )

  export const defaultLayer = layer

  function filepath() {
    return path.join(Global.Path.data, "connectors-auth.json")
  }

  async function getImpl(connectorName: string): Promise<Entry | undefined> {
    const data = await allImpl()
    return data[connectorName]
  }

  async function allImpl(): Promise<Record<string, Entry>> {
    const file = Bun.file(filepath())
    return file.json().catch(() => ({}))
  }

  async function setImpl(connectorName: string, entry: Entry): Promise<void> {
    const file = filepath()
    const data = await allImpl()
    await Bun.write(file, JSON.stringify({ ...data, [connectorName]: entry }, null, 2))
    // chmod is Unix-only, skip on Windows
    if (process.platform !== "win32") {
      await fs.chmod(file, 0o600)
    }
  }

  async function removeImpl(connectorName: string): Promise<void> {
    const file = filepath()
    const data = await allImpl()
    delete data[connectorName]
    await Bun.write(file, JSON.stringify(data, null, 2))
    // chmod is Unix-only, skip on Windows
    if (process.platform !== "win32") {
      await fs.chmod(file, 0o600)
    }
  }

  async function updateTokenImpl(connectorName: string, token: string, expiresAt?: number): Promise<void> {
    const entry = (await getImpl(connectorName)) ?? {}
    entry.token = token
    if (expiresAt) entry.expiresAt = expiresAt
    await setImpl(connectorName, entry)
  }

  async function updateBotTokenImpl(connectorName: string, botToken: string, teamId?: string): Promise<void> {
    const entry = (await getImpl(connectorName)) ?? {}
    entry.botToken = botToken
    if (teamId) entry.teamId = teamId
    await setImpl(connectorName, entry)
  }

  async function updateApiKeyImpl(connectorName: string, apiKey: string): Promise<void> {
    const entry = (await getImpl(connectorName)) ?? {}
    entry.apiKey = apiKey
    await setImpl(connectorName, entry)
  }

  async function isTokenExpiredImpl(connectorName: string): Promise<boolean | null> {
    const entry = await getImpl(connectorName)
    if (!entry?.expiresAt) return null
    return entry.expiresAt < Date.now() / 1000
  }
}
