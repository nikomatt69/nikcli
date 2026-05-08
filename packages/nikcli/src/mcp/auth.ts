import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Context, Effect, Layer, Schema } from "effect"
import { zodObject, type DeepMutable } from "@/util/effect-zod"

export namespace McpAuth {
  const TokensSchema = Schema.Struct({
    accessToken: Schema.String,
    refreshToken: Schema.optional(Schema.String),
    expiresAt: Schema.optional(Schema.Number),
    scope: Schema.optional(Schema.String),
  })
  export const Tokens = zodObject(TokensSchema)
  export type Tokens = DeepMutable<Schema.Schema.Type<typeof TokensSchema>>

  const ClientInfoSchema = Schema.Struct({
    clientId: Schema.String,
    clientSecret: Schema.optional(Schema.String),
    clientIdIssuedAt: Schema.optional(Schema.Number),
    clientSecretExpiresAt: Schema.optional(Schema.Number),
  })
  export const ClientInfo = zodObject(ClientInfoSchema)
  export type ClientInfo = DeepMutable<Schema.Schema.Type<typeof ClientInfoSchema>>

  const EntrySchema = Schema.Struct({
    tokens: Schema.optional(TokensSchema),
    clientInfo: Schema.optional(ClientInfoSchema),
    codeVerifier: Schema.optional(Schema.String),
    oauthState: Schema.optional(Schema.String),
    serverUrl: Schema.optional(Schema.String),
  })
  export const Entry = zodObject(EntrySchema)
  export type Entry = DeepMutable<Schema.Schema.Type<typeof EntrySchema>>

  export interface Interface {
    get(mcpName: string): Effect.Effect<Entry | undefined, unknown>
    getForUrl(mcpName: string, serverUrl: string): Effect.Effect<Entry | undefined, unknown>
    all(): Effect.Effect<Record<string, Entry>, unknown>
    set(mcpName: string, entry: Entry, serverUrl?: string): Effect.Effect<void, unknown>
    remove(mcpName: string): Effect.Effect<void, unknown>
    updateTokens(mcpName: string, tokens: Tokens, serverUrl?: string): Effect.Effect<void, unknown>
    updateClientInfo(mcpName: string, clientInfo: ClientInfo, serverUrl?: string): Effect.Effect<void, unknown>
    updateCodeVerifier(mcpName: string, codeVerifier: string): Effect.Effect<void, unknown>
    clearCodeVerifier(mcpName: string): Effect.Effect<void, unknown>
    updateOAuthState(mcpName: string, oauthState: string): Effect.Effect<void, unknown>
    getOAuthState(mcpName: string): Effect.Effect<string | undefined, unknown>
    clearOAuthState(mcpName: string): Effect.Effect<void, unknown>
    isTokenExpired(mcpName: string): Effect.Effect<boolean | null, unknown>
  }

  export class Service extends Context.Tag("McpAuth.Service")<Service, Interface>() {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      get: (mcpName) => Effect.tryPromise(() => getImpl(mcpName)),
      getForUrl: (mcpName, serverUrl) => Effect.tryPromise(() => getForUrlImpl(mcpName, serverUrl)),
      all: () => Effect.tryPromise(() => allImpl()),
      set: (mcpName, entry, serverUrl) => Effect.tryPromise(() => setImpl(mcpName, entry, serverUrl)),
      remove: (mcpName) => Effect.tryPromise(() => removeImpl(mcpName)),
      updateTokens: (mcpName, tokens, serverUrl) =>
        Effect.tryPromise(() => updateTokensImpl(mcpName, tokens, serverUrl)),
      updateClientInfo: (mcpName, clientInfo, serverUrl) =>
        Effect.tryPromise(() => updateClientInfoImpl(mcpName, clientInfo, serverUrl)),
      updateCodeVerifier: (mcpName, codeVerifier) => Effect.tryPromise(() => updateCodeVerifierImpl(mcpName, codeVerifier)),
      clearCodeVerifier: (mcpName) => Effect.tryPromise(() => clearCodeVerifierImpl(mcpName)),
      updateOAuthState: (mcpName, oauthState) => Effect.tryPromise(() => updateOAuthStateImpl(mcpName, oauthState)),
      getOAuthState: (mcpName) => Effect.tryPromise(() => getOAuthStateImpl(mcpName)),
      clearOAuthState: (mcpName) => Effect.tryPromise(() => clearOAuthStateImpl(mcpName)),
      isTokenExpired: (mcpName) => Effect.tryPromise(() => isTokenExpiredImpl(mcpName)),
    }),
  )

  export const defaultLayer = layer

  function filepath() {
    return path.join(Global.Path.data, "mcp-auth.json")
  }

  async function getImpl(mcpName: string): Promise<Entry | undefined> {
    const data = await allImpl()
    return data[mcpName]
  }

  async function getForUrlImpl(mcpName: string, serverUrl: string): Promise<Entry | undefined> {
    const entry = await getImpl(mcpName)
    if (!entry) return undefined
    if (!entry.serverUrl) return undefined
    if (entry.serverUrl !== serverUrl) return undefined
    return entry
  }

  async function allImpl(): Promise<Record<string, Entry>> {
    const file = Bun.file(filepath())
    return file.json().catch(() => ({}))
  }

  async function setImpl(mcpName: string, entry: Entry, serverUrl?: string): Promise<void> {
    const file = Bun.file(filepath())
    const data = await allImpl()
    if (serverUrl) {
      entry.serverUrl = serverUrl
    }
    await Bun.write(file, JSON.stringify({ ...data, [mcpName]: entry }, null, 2))
    // chmod is Unix-only, skip on Windows
    if (process.platform !== "win32") {
      await fs.chmod(file.name!, 0o600)
    }
  }

  async function removeImpl(mcpName: string): Promise<void> {
    const file = Bun.file(filepath())
    const data = await allImpl()
    delete data[mcpName]
    await Bun.write(file, JSON.stringify(data, null, 2))
    // chmod is Unix-only, skip on Windows
    if (process.platform !== "win32") {
      await fs.chmod(file.name!, 0o600)
    }
  }

  async function updateTokensImpl(mcpName: string, tokens: Tokens, serverUrl?: string): Promise<void> {
    const entry = (await getImpl(mcpName)) ?? {}
    entry.tokens = tokens
    await setImpl(mcpName, entry, serverUrl)
  }

  async function updateClientInfoImpl(mcpName: string, clientInfo: ClientInfo, serverUrl?: string): Promise<void> {
    const entry = (await getImpl(mcpName)) ?? {}
    entry.clientInfo = clientInfo
    await setImpl(mcpName, entry, serverUrl)
  }

  async function updateCodeVerifierImpl(mcpName: string, codeVerifier: string): Promise<void> {
    const entry = (await getImpl(mcpName)) ?? {}
    entry.codeVerifier = codeVerifier
    await setImpl(mcpName, entry)
  }

  async function clearCodeVerifierImpl(mcpName: string): Promise<void> {
    const entry = await getImpl(mcpName)
    if (entry) {
      delete entry.codeVerifier
      await setImpl(mcpName, entry)
    }
  }

  async function updateOAuthStateImpl(mcpName: string, oauthState: string): Promise<void> {
    const entry = (await getImpl(mcpName)) ?? {}
    entry.oauthState = oauthState
    await setImpl(mcpName, entry)
  }

  async function getOAuthStateImpl(mcpName: string): Promise<string | undefined> {
    const entry = await getImpl(mcpName)
    return entry?.oauthState
  }

  async function clearOAuthStateImpl(mcpName: string): Promise<void> {
    const entry = await getImpl(mcpName)
    if (entry) {
      delete entry.oauthState
      await setImpl(mcpName, entry)
    }
  }

  async function isTokenExpiredImpl(mcpName: string): Promise<boolean | null> {
    const entry = await getImpl(mcpName)
    if (!entry?.tokens) return null
    if (!entry.tokens.expiresAt) return false
    return entry.tokens.expiresAt < Date.now() / 1000
  }
}
