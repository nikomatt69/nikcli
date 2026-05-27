import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "../global"
import { Context, Effect, Layer, Schema } from "effect"

export namespace McpAuth {
  export class McpAuthError extends Schema.TaggedErrorClass<McpAuthError>()("McpAuthError", {
    cause: Schema.Unknown,
  }) {}

  export const Tokens = z.object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(),
    scope: z.string().optional(),
  })
  export type Tokens = z.infer<typeof Tokens>

  export const ClientInfo = z.object({
    clientId: z.string(),
    clientSecret: z.string().optional(),
    clientIdIssuedAt: z.number().optional(),
    clientSecretExpiresAt: z.number().optional(),
  })
  export type ClientInfo = z.infer<typeof ClientInfo>

  export const Entry = z.object({
    tokens: Tokens.optional(),
    clientInfo: ClientInfo.optional(),
    codeVerifier: z.string().optional(),
    oauthState: z.string().optional(),
    serverUrl: z.string().optional(),
  })
  export type Entry = z.infer<typeof Entry>

  export interface Interface {
    get(mcpName: string): Effect.Effect<Entry | undefined, McpAuthError>
    getForUrl(mcpName: string, serverUrl: string): Effect.Effect<Entry | undefined, McpAuthError>
    all(): Effect.Effect<Record<string, Entry>, McpAuthError>
    set(mcpName: string, entry: Entry, serverUrl?: string): Effect.Effect<void, McpAuthError>
    remove(mcpName: string): Effect.Effect<void, McpAuthError>
    updateTokens(mcpName: string, tokens: Tokens, serverUrl?: string): Effect.Effect<void, McpAuthError>
    updateClientInfo(mcpName: string, clientInfo: ClientInfo, serverUrl?: string): Effect.Effect<void, McpAuthError>
    updateCodeVerifier(mcpName: string, codeVerifier: string): Effect.Effect<void, McpAuthError>
    clearCodeVerifier(mcpName: string): Effect.Effect<void, McpAuthError>
    updateOAuthState(mcpName: string, oauthState: string): Effect.Effect<void, McpAuthError>
    getOAuthState(mcpName: string): Effect.Effect<string | undefined, McpAuthError>
    clearOAuthState(mcpName: string): Effect.Effect<void, McpAuthError>
    isTokenExpired(mcpName: string): Effect.Effect<boolean | null, McpAuthError>
  }

  export class Service extends Context.Service<Service, Interface>()("McpAuth.Service") {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      get: (mcpName) => Effect.tryPromise({ try: () => getImpl(mcpName), catch: (e) => new McpAuthError({ cause: e }) }),
      getForUrl: (mcpName, serverUrl) => Effect.tryPromise({ try: () => getForUrlImpl(mcpName, serverUrl), catch: (e) => new McpAuthError({ cause: e }) }),
      all: () => Effect.tryPromise({ try: () => allImpl(), catch: (e) => new McpAuthError({ cause: e }) }),
      set: (mcpName, entry, serverUrl) => Effect.tryPromise({ try: () => setImpl(mcpName, entry, serverUrl), catch: (e) => new McpAuthError({ cause: e }) }),
      remove: (mcpName) => Effect.tryPromise({ try: () => removeImpl(mcpName), catch: (e) => new McpAuthError({ cause: e }) }),
      updateTokens: (mcpName, tokens, serverUrl) =>
        Effect.tryPromise({ try: () => updateTokensImpl(mcpName, tokens, serverUrl), catch: (e) => new McpAuthError({ cause: e }) }),
      updateClientInfo: (mcpName, clientInfo, serverUrl) =>
        Effect.tryPromise({ try: () => updateClientInfoImpl(mcpName, clientInfo, serverUrl), catch: (e) => new McpAuthError({ cause: e }) }),
      updateCodeVerifier: (mcpName, codeVerifier) =>
        Effect.tryPromise({ try: () => updateCodeVerifierImpl(mcpName, codeVerifier), catch: (e) => new McpAuthError({ cause: e }) }),
      clearCodeVerifier: (mcpName) => Effect.tryPromise({ try: () => clearCodeVerifierImpl(mcpName), catch: (e) => new McpAuthError({ cause: e }) }),
      updateOAuthState: (mcpName, oauthState) => Effect.tryPromise({ try: () => updateOAuthStateImpl(mcpName, oauthState), catch: (e) => new McpAuthError({ cause: e }) }),
      getOAuthState: (mcpName) => Effect.tryPromise({ try: () => getOAuthStateImpl(mcpName), catch: (e) => new McpAuthError({ cause: e }) }),
      clearOAuthState: (mcpName) => Effect.tryPromise({ try: () => clearOAuthStateImpl(mcpName), catch: (e) => new McpAuthError({ cause: e }) }),
      isTokenExpired: (mcpName) => Effect.tryPromise({ try: () => isTokenExpiredImpl(mcpName), catch: (e) => new McpAuthError({ cause: e }) }),
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
