import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { type DeepMutable, zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"

export namespace ConnectorAuth {
  export class ConnectorAuthError extends Schema.TaggedErrorClass<ConnectorAuthError>()("ConnectorAuthError", {
    cause: Schema.Unknown,
  }) {}

  const EntrySchema = Schema.Struct({
    token: Schema.optional(Schema.String),
    botToken: Schema.optional(Schema.String),
    apiKey: Schema.optional(Schema.String),
    teamId: Schema.optional(Schema.String),
    expiresAt: Schema.optional(Schema.Number),
  })
  export const Entry = zodObject(EntrySchema)
  export type Entry = DeepMutable<Schema.Schema.Type<typeof EntrySchema>>

  export interface Interface {
    get(connectorName: string): Effect.Effect<Entry | undefined, ConnectorAuthError>
    all(): Effect.Effect<Record<string, Entry>, ConnectorAuthError>
    set(connectorName: string, entry: Entry): Effect.Effect<void, ConnectorAuthError>
    remove(connectorName: string): Effect.Effect<void, ConnectorAuthError>
    updateToken(connectorName: string, token: string, expiresAt?: number): Effect.Effect<void, ConnectorAuthError>
    updateBotToken(connectorName: string, botToken: string, teamId?: string): Effect.Effect<void, ConnectorAuthError>
    updateApiKey(connectorName: string, apiKey: string): Effect.Effect<void, ConnectorAuthError>
    isTokenExpired(connectorName: string): Effect.Effect<boolean | null, ConnectorAuthError>
  }

  export class Service extends Context.Service<Service, Interface>()("ConnectorAuth.Service") {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      get: (connectorName) =>
        Effect.tryPromise({ try: () => getImpl(connectorName), catch: (e) => new ConnectorAuthError({ cause: e }) }),
      all: () => Effect.tryPromise({ try: () => allImpl(), catch: (e) => new ConnectorAuthError({ cause: e }) }),
      set: (connectorName, entry) =>
        Effect.tryPromise({ try: () => setImpl(connectorName, entry), catch: (e) => new ConnectorAuthError({ cause: e }) }),
      remove: (connectorName) =>
        Effect.tryPromise({ try: () => removeImpl(connectorName), catch: (e) => new ConnectorAuthError({ cause: e }) }),
      updateToken: (connectorName, token, expiresAt) =>
        Effect.tryPromise({
          try: () => updateTokenImpl(connectorName, token, expiresAt),
          catch: (e) => new ConnectorAuthError({ cause: e }),
        }),
      updateBotToken: (connectorName, botToken, teamId) =>
        Effect.tryPromise({
          try: () => updateBotTokenImpl(connectorName, botToken, teamId),
          catch: (e) => new ConnectorAuthError({ cause: e }),
        }),
      updateApiKey: (connectorName, apiKey) =>
        Effect.tryPromise({
          try: () => updateApiKeyImpl(connectorName, apiKey),
          catch: (e) => new ConnectorAuthError({ cause: e }),
        }),
      isTokenExpired: (connectorName) =>
        Effect.tryPromise({ try: () => isTokenExpiredImpl(connectorName), catch: (e) => new ConnectorAuthError({ cause: e }) }),
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
