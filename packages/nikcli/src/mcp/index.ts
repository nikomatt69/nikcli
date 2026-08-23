import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config/config"
import { Log } from "@nikcli-ai/util/log"
import z from "zod/v4"
import { Installation } from "../installation"
import { withTimeout } from "@/util/timeout"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import { TuiEvent } from "@/bus/tui-event"
import open from "open"
import { Context, Effect, Layer, Schema } from "effect"
import { InstanceState, locallyInstance, runPromiseWithLayer } from "@/effect"
import type { InstanceContext } from "@/effect"

function runMcpAuth<A, E>(effect: Effect.Effect<A, E, McpAuth.Service>) {
  return runPromiseWithLayer(McpAuth.defaultLayer, effect)
}

function runConfig<A, E>(ctx: InstanceContext, effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, locallyInstance(ctx, effect))
}

function getConfig(ctx: InstanceContext) {
  return runConfig(
    ctx,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.get()
    }),
  )
}

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = 30_000

  export const Resource = z
    .object({
      name: z.string(),
      uri: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
      client: z.string(),
    })
    .meta({ ref: "McpResource" })
  export type Resource = z.infer<typeof Resource>

  export const ToolsChanged = BusEvent.schema(
    "mcp.tools.changed",
    Schema.Struct({
      server: Schema.String,
    }),
  )

  // Internal: `cli/cmd/mcp.ts` subscribes in the same process to print the
  // authorization URL when the browser could not be opened for it. A remote
  // client has no browser to fall back to. See `specs/v2/public-event-filter.md`.
  export const BrowserOpenFailed = BusEvent.schema(
    "mcp.browser.open.failed",
    Schema.Struct({
      mcpName: Schema.String,
      url: Schema.String,
    }),
    { visibility: "internal" },
  )

  export class Failed extends Schema.TaggedErrorClass<Failed>()("MCPFailed", {
    name: Schema.String,
  }) {}

  type MCPClient = Client

  export const Status = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({
          ref: "MCPStatusConnected",
        }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({
          ref: "MCPStatusDisabled",
        }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusFailed",
        }),
      z
        .object({
          status: z.literal("needs_auth"),
        })
        .meta({
          ref: "MCPStatusNeedsAuth",
        }),
      z
        .object({
          status: z.literal("needs_client_registration"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusNeedsClientRegistration",
        }),
    ])
    .meta({
      ref: "MCPStatus",
    })
  export type Status = z.infer<typeof Status>

  function registerNotificationHandlers(client: MCPClient, serverName: string) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      log.info("tools list changed notification received", { server: serverName })
      Bus.publish(ToolsChanged, { server: serverName })
    })
  }

  export function normalizeToolInputSchema(inputSchema: JSONSchema7 | undefined): JSONSchema7 {
    return {
      ...inputSchema,
      type: "object",
      properties: (inputSchema?.properties ?? {}) as JSONSchema7["properties"],
      additionalProperties: false,
    }
  }

  async function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Promise<Tool> {
    // `inputSchema` is required by the MCP spec but servers do omit it for
    // no-argument tools. Reading `.properties` off undefined used to throw here
    // and take down the whole server's tool list, so treat it as "no arguments".
    const schema = normalizeToolInputSchema(mcpTool.inputSchema as JSONSchema7 | undefined)

    return dynamicTool({
      description: mcpTool.description ?? "",
      inputSchema: jsonSchema(schema),
      execute: async (args: unknown) => {
        return client.callTool(
          {
            name: mcpTool.name,
            arguments: args as Record<string, unknown>,
          },
          CallToolResultSchema,
          {
            resetTimeoutOnProgress: true,
            timeout,
          },
        )
      },
    })
  }

  type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
  const pendingOAuthTransports = new Map<string, TransportWithAuth>()

  type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
  type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
  type McpEntry = NonNullable<Config.Info["mcp"]>[string]
  function isMcpConfigured(entry: McpEntry): entry is Config.Mcp {
    return typeof entry === "object" && entry !== null && "type" in entry
  }

  type State = {
    status: Record<string, Status>
    clients: Record<string, MCPClient>
    context: InstanceContext
  }

  export interface Interface {
    add(name: string, mcp: Config.Mcp): Effect.Effect<{ status: Record<string, Status> | Status }, unknown>
    status(): Effect.Effect<Record<string, Status>, unknown>
    clients(): Effect.Effect<Record<string, MCPClient>, unknown>
    connect(name: string): Effect.Effect<void, unknown>
    disconnect(name: string): Effect.Effect<void, unknown>
    tools(): Effect.Effect<Record<string, Tool>, unknown>
    prompts(): Effect.Effect<Record<string, PromptInfo & { client: string }>, unknown>
    resources(): Effect.Effect<Record<string, ResourceInfo & { client: string }>, unknown>
    getPrompt(
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ): Effect.Effect<Awaited<ReturnType<MCPClient["getPrompt"]>> | undefined, unknown>
    readResource(
      clientName: string,
      resourceUri: string,
    ): Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>> | undefined, unknown>
    startAuth(mcpName: string): Effect.Effect<{ authorizationUrl: string }, unknown>
    authenticate(mcpName: string): Effect.Effect<Status, unknown>
    finishAuth(mcpName: string, authorizationCode: string): Effect.Effect<Status, unknown>
    removeAuth(mcpName: string): Effect.Effect<void, unknown>
    supportsOAuth(mcpName: string): Effect.Effect<boolean, unknown>
    hasStoredTokens(mcpName: string): Effect.Effect<boolean, unknown>
    getAuthStatus(mcpName: string): Effect.Effect<AuthStatus, unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("MCP.Service") {}

  const state = InstanceState.make<State>((ctx) =>
    Effect.gen(function* () {
      const cfg = yield* Effect.promise(() => getConfig(ctx))
      const config = cfg.mcp ?? {}
      const clients: Record<string, MCPClient> = {}
      const status: Record<string, Status> = {}

      yield* Effect.promise(() =>
        Promise.all(
          Object.entries(config).map(async ([key, mcp]) => {
            if (!isMcpConfigured(mcp)) {
              log.error("Ignoring MCP config entry without type", { key })
              return
            }

            if (mcp.enabled === false) {
              status[key] = { status: "disabled" }
              return
            }

            const result = await create(ctx, key, mcp).catch(() => undefined)
            if (!result) return

            status[key] = result.status

            if (result.mcpClient) {
              clients[key] = result.mcpClient
            }
          }),
        ),
      )
      const initializedState = {
        status,
        clients,
        context: ctx,
      }
      yield* Effect.addFinalizer(() => Effect.promise(() => shutdown(initializedState)))
      return initializedState
    }),
  )

  async function shutdown(state: Pick<State, "clients">) {
    await Promise.all(
      Object.values(state.clients).map((client) =>
        client.close().catch((error) => {
          log.error("Failed to close MCP client", {
            error,
          })
        }),
      ),
    )
    pendingOAuthTransports.clear()
  }

  async function fetchPromptsForClient(clientName: string, client: Client) {
    const prompts = await client.listPrompts().catch((e) => {
      log.error("failed to get prompts", { clientName, error: e.message })
      return undefined
    })

    if (!prompts) {
      return
    }

    const commands: Record<string, PromptInfo & { client: string }> = {}

    for (const prompt of prompts.prompts) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedPromptName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = sanitizedClientName + ":" + sanitizedPromptName

      commands[key] = { ...prompt, client: clientName }
    }
    return commands
  }

  async function fetchResourcesForClient(clientName: string, client: Client) {
    const resources = await client.listResources().catch((e) => {
      log.error("failed to get prompts", { clientName, error: e.message })
      return undefined
    })

    if (!resources) {
      return
    }

    const commands: Record<string, ResourceInfo & { client: string }> = {}

    for (const resource of resources.resources) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedResourceName = resource.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = sanitizedClientName + ":" + sanitizedResourceName

      commands[key] = { ...resource, client: clientName }
    }
    return commands
  }

  async function addImpl(s: State, name: string, mcp: Config.Mcp) {
    const result = await create(s.context, name, mcp)
    if (!result) {
      const status = {
        status: "failed" as const,
        error: "unknown error",
      }
      s.status[name] = status
      return {
        status,
      }
    }
    if (!result.mcpClient) {
      s.status[name] = result.status
      return {
        status: s.status,
      }
    }
    const existingClient = s.clients[name]
    if (existingClient) {
      await existingClient.close().catch((error) => {
        log.error("Failed to close existing MCP client", { name, error })
      })
    }
    s.clients[name] = result.mcpClient
    s.status[name] = result.status

    return {
      status: s.status,
    }
  }

  async function create(ctx: InstanceContext, key: string, mcp: Config.Mcp) {
    if (mcp.enabled === false) {
      log.info("mcp server disabled", { key })
      return {
        mcpClient: undefined,
        status: { status: "disabled" as const },
      }
    }

    log.info("found", { key, type: mcp.type })
    let mcpClient: MCPClient | undefined
    let status: Status | undefined = undefined

    if (mcp.type === "remote") {
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      let authProvider: McpOAuthProvider | undefined

      if (!oauthDisabled) {
        authProvider = new McpOAuthProvider(
          key,
          mcp.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
          },
          {
            onRedirect: async (url) => {
              log.info("oauth redirect requested", { key, url: url.toString() })
            },
          },
        )
      }

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
        {
          name: "SSE",
          transport: new SSEClientTransport(new URL(mcp.url), {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
      ]

      let lastError: Error | undefined
      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      for (const { name, transport } of transports) {
        try {
          const client = new Client({
            name: "nikcli",
            version: Installation.VERSION,
          })
          await withTimeout(client.connect(transport), connectTimeout)
          registerNotificationHandlers(client, key)
          mcpClient = client
          log.info("connected", { key, transport: name })
          status = { status: "connected" }
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))

          if (error instanceof UnauthorizedError) {
            log.info("mcp server requires authentication", { key, transport: name })

            if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
              status = {
                status: "needs_client_registration" as const,
                error: "Server does not support dynamic client registration. Please provide clientId in config.",
              }
              Bus.publish(TuiEvent.ToastShow, {
                title: "MCP Authentication Required",
                message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                variant: "warning",
                duration: 8000,
              }).catch((e) => log.debug("failed to show toast", { error: e }))
            } else {
              pendingOAuthTransports.set(key, transport)
              status = { status: "needs_auth" as const }
              Bus.publish(TuiEvent.ToastShow, {
                title: "MCP Authentication Required",
                message: `Server "${key}" requires authentication. Run: nikcli mcp auth ${key}`,
                variant: "warning",
                duration: 8000,
              }).catch((e) => log.debug("failed to show toast", { error: e }))
            }
            break
          }

          log.debug("transport connection failed", {
            key,
            transport: name,
            url: mcp.url,
            error: lastError.message,
          })
          status = {
            status: "failed" as const,
            error: lastError.message,
          }
        }
      }
    }

    if (mcp.type === "local") {
      const [cmd, ...args] = mcp.command
      const cwd = ctx.directory
      const transport = new StdioClientTransport({
        stderr: "ignore",
        command: cmd,
        args,
        cwd,
        env: {
          ...process.env,
          ...(cmd === "nikcli" ? { BUN_BE_BUN: "1" } : undefined),
          ...mcp.environment,
        },
      })

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      try {
        const client = new Client({
          name: "nikcli",
          version: Installation.VERSION,
        })
        await withTimeout(client.connect(transport), connectTimeout)
        registerNotificationHandlers(client, key)
        mcpClient = client
        status = {
          status: "connected",
        }
      } catch (error) {
        log.error("local mcp startup failed", {
          key,
          command: mcp.command,
          cwd,
          error: error instanceof Error ? error.message : String(error),
        })
        status = {
          status: "failed" as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    if (!status) {
      status = {
        status: "failed" as const,
        error: "Unknown error",
      }
    }

    if (!mcpClient) {
      return {
        mcpClient: undefined,
        status,
      }
    }

    const result = await withTimeout(mcpClient.listTools(), mcp.timeout ?? DEFAULT_TIMEOUT).catch((err) => {
      log.error("failed to get tools from client", { key, error: err })
      return undefined
    })
    if (!result) {
      await mcpClient.close().catch((error) => {
        log.error("Failed to close MCP client", {
          error,
        })
      })
      status = {
        status: "failed",
        error: "Failed to get tools",
      }
      return {
        mcpClient: undefined,
        status: {
          status: "failed" as const,
          error: "Failed to get tools",
        },
      }
    }

    log.info("create() successfully created client", { key, toolCount: result.tools.length })
    return {
      mcpClient,
      status,
    }
  }

  async function statusImpl(s: State) {
    const cfg = await getConfig(s.context)
    const config = cfg.mcp ?? {}
    const result: Record<string, Status> = {}

    for (const [key, mcp] of Object.entries(config)) {
      if (!isMcpConfigured(mcp)) continue
      result[key] = s.status[key] ?? { status: "disabled" }
    }

    return result
  }

  async function clientsImpl(s: State) {
    return s.clients
  }

  async function connectImpl(s: State, name: string) {
    const cfg = await getConfig(s.context)
    const config = cfg.mcp ?? {}
    const mcp = config[name]
    if (!mcp) {
      log.error("MCP config not found", { name })
      return
    }

    if (!isMcpConfigured(mcp)) {
      log.error("Ignoring MCP connect request for config without type", { name })
      return
    }

    const result = await create(s.context, name, { ...mcp, enabled: true })

    if (!result) {
      s.status[name] = {
        status: "failed",
        error: "Unknown error during connection",
      }
      return
    }

    s.status[name] = result.status
    if (result.mcpClient) {
      const existingClient = s.clients[name]
      if (existingClient) {
        await existingClient.close().catch((error) => {
          log.error("Failed to close existing MCP client", { name, error })
        })
      }
      s.clients[name] = result.mcpClient
    }
  }

  async function disconnectImpl(s: State, name: string) {
    const client = s.clients[name]
    if (client) {
      await client.close().catch((error) => {
        log.error("Failed to close MCP client", { name, error })
      })
      delete s.clients[name]
    }
    s.status[name] = { status: "disabled" }
  }

  async function toolsImpl(s: State) {
    const result: Record<string, Tool> = {}
    const cfg = await getConfig(s.context)
    const config = cfg.mcp ?? {}
    const clientsSnapshot = await clientsImpl(s)
    const defaultTimeout = cfg.experimental?.mcp_timeout

    // Collect failures first, then apply mutations atomically
    const failedClients: string[] = []
    const failedErrors: Record<string, string> = {}

    for (const [clientName, client] of Object.entries(clientsSnapshot)) {
      if (s.status[clientName]?.status !== "connected") {
        continue
      }

      const toolsResult = await client.listTools().catch((e) => {
        const errorMsg = e instanceof Error ? e.message : String(e)
        failedClients.push(clientName)
        failedErrors[clientName] = errorMsg
        return undefined
      })
      if (!toolsResult) {
        continue
      }
      const mcpConfig = config[clientName]
      const entry = isMcpConfigured(mcpConfig) ? mcpConfig : undefined
      const timeout = entry?.timeout ?? defaultTimeout
      for (const mcpTool of toolsResult.tools) {
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
        const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
        result[sanitizedClientName + "_" + sanitizedToolName] = await convertMcpTool(mcpTool, client, timeout)
      }
    }

    // Apply all failures after collecting (prevents race conditions)
    for (const clientName of failedClients) {
      log.error("failed to get tools", { clientName, error: failedErrors[clientName] })
      s.status[clientName] = { status: "failed" as const, error: failedErrors[clientName] }
      delete s.clients[clientName]
    }

    return result
  }

  async function promptsImpl(s: State) {
    const clientsSnapshot = await clientsImpl(s)

    const prompts = Object.fromEntries<PromptInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries((await fetchPromptsForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return prompts
  }

  async function resourcesImpl(s: State) {
    const clientsSnapshot = await clientsImpl(s)

    const result = Object.fromEntries<ResourceInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries((await fetchResourcesForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return result
  }

  async function getPromptImpl(s: State, clientName: string, name: string, args?: Record<string, string>) {
    const clientsSnapshot = await clientsImpl(s)
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName,
      })
      return undefined
    }

    const result = await client
      .getPrompt({
        name: name,
        arguments: args,
      })
      .catch((e) => {
        log.error("failed to get prompt from MCP server", {
          clientName,
          promptName: name,
          error: e.message,
        })
        return undefined
      })

    return result
  }

  async function readResourceImpl(s: State, clientName: string, resourceUri: string) {
    const clientsSnapshot = await clientsImpl(s)
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName: clientName,
      })
      return undefined
    }

    const result = await client
      .readResource({
        uri: resourceUri,
      })
      .catch((e) => {
        log.error("failed to get prompt from MCP server", {
          clientName: clientName,
          resourceUri: resourceUri,
          error: e.message,
        })
        return undefined
      })

    return result
  }

  async function startAuthImpl(s: State, mcpName: string): Promise<{ authorizationUrl: string }> {
    const cfg = await getConfig(s.context)
    const mcpConfig = cfg.mcp?.[mcpName]

    if (!mcpConfig) {
      throw new Error(`MCP server not found: ${mcpName}`)
    }

    if (!isMcpConfigured(mcpConfig)) {
      throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }

    if (mcpConfig.type !== "remote") {
      throw new Error(`MCP server ${mcpName} is not a remote server`)
    }

    if (mcpConfig.oauth === false) {
      throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
    }

    await McpOAuthCallback.ensureRunning()

    const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    await runMcpAuth(
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        yield* auth.updateOAuthState(mcpName, oauthState)
      }),
    )

    const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
    let capturedUrl: URL | undefined
    const authProvider = new McpOAuthProvider(
      mcpName,
      mcpConfig.url,
      {
        clientId: oauthConfig?.clientId,
        clientSecret: oauthConfig?.clientSecret,
        scope: oauthConfig?.scope,
      },
      {
        onRedirect: async (url) => {
          capturedUrl = url
        },
      },
    )

    const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), {
      authProvider,
    })

    try {
      const client = new Client({
        name: "nikcli",
        version: Installation.VERSION,
      })
      await client.connect(transport)
      return { authorizationUrl: "" }
    } catch (error) {
      if (error instanceof UnauthorizedError && capturedUrl) {
        pendingOAuthTransports.set(mcpName, transport)
        return { authorizationUrl: capturedUrl.toString() }
      }
      throw error
    }
  }

  async function authenticateImpl(s: State, mcpName: string): Promise<Status> {
    const { authorizationUrl } = await startAuthImpl(s, mcpName)

    if (!authorizationUrl) {
      return s.status[mcpName] ?? { status: "connected" }
    }

    const oauthState = await runMcpAuth(
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        return yield* auth.getOAuthState(mcpName)
      }),
    )
    if (!oauthState) {
      throw new Error("OAuth state not found - this should not happen")
    }

    log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })

    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState)

    try {
      const subprocess = await open(authorizationUrl)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(), 500)
        subprocess.on("error", (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        subprocess.on("exit", (code) => {
          if (code !== null && code !== 0) {
            clearTimeout(timeout)
            reject(new Error(`Browser open failed with exit code ${code}`))
          }
        })
      })
    } catch (error) {
      log.warn("failed to open browser, user must open URL manually", { mcpName, error })
      Bus.publish(BrowserOpenFailed, { mcpName, url: authorizationUrl })
    }

    const code = await callbackPromise

    const storedState = await runMcpAuth(
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        return yield* auth.getOAuthState(mcpName)
      }),
    )
    if (storedState !== oauthState) {
      await runMcpAuth(
        Effect.gen(function* () {
          const auth = yield* McpAuth.Service
          yield* auth.clearOAuthState(mcpName)
        }),
      )
      throw new Error("OAuth state mismatch - potential CSRF attack")
    }

    await runMcpAuth(
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        yield* auth.clearOAuthState(mcpName)
      }),
    )

    return finishAuthImpl(s, mcpName, code)
  }

  async function finishAuthImpl(s: State, mcpName: string, authorizationCode: string): Promise<Status> {
    const transport = pendingOAuthTransports.get(mcpName)

    if (!transport) {
      throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)
    }

    let client: Client | undefined
    try {
      const cfg = await getConfig(s.context)
      const mcpConfig = cfg.mcp?.[mcpName]

      if (!mcpConfig) {
        throw new Error(`MCP server not found: ${mcpName}`)
      }

      if (!isMcpConfigured(mcpConfig)) {
        throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
      }

      await transport.finishAuth(authorizationCode)
      await runMcpAuth(
        Effect.gen(function* () {
          const auth = yield* McpAuth.Service
          yield* auth.clearCodeVerifier(mcpName)
        }),
      )

      client = new Client({
        name: "nikcli",
        version: Installation.VERSION,
      })

      const connectTimeout = mcpConfig.timeout ?? DEFAULT_TIMEOUT
      await withTimeout(client.connect(transport), connectTimeout)
      registerNotificationHandlers(client, mcpName)

      const toolsResult = await withTimeout(client.listTools(), connectTimeout).catch((error) => {
        log.error("failed to get tools from oauth-connected client", { mcpName, error })
        return undefined
      })

      if (!toolsResult) {
        throw new Error("Failed to get tools")
      }

      const existingClient = s.clients[mcpName]
      if (existingClient) {
        await existingClient.close().catch((error) => {
          log.error("Failed to close existing MCP client", { name: mcpName, error })
        })
      }

      s.clients[mcpName] = client
      s.status[mcpName] = { status: "connected" }
      pendingOAuthTransports.delete(mcpName)
      log.info("connected pending oauth transport", { mcpName, toolCount: toolsResult.tools.length })

      return s.status[mcpName]
    } catch (error) {
      pendingOAuthTransports.delete(mcpName)
      if (client) {
        await client.close().catch(() => undefined)
      }
      log.error("failed to finish oauth", { mcpName, error })
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async function removeAuthImpl(mcpName: string): Promise<void> {
    await runMcpAuth(
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        yield* auth.remove(mcpName)
      }),
    )
    McpOAuthCallback.cancelPending(mcpName)
    pendingOAuthTransports.delete(mcpName)
    await runMcpAuth(
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        yield* auth.clearOAuthState(mcpName)
      }),
    )
    log.info("removed oauth credentials", { mcpName })
  }

  async function supportsOAuthImpl(s: State, mcpName: string): Promise<boolean> {
    const cfg = await getConfig(s.context)
    const mcpConfig = cfg.mcp?.[mcpName]
    if (!mcpConfig) return false
    if (!isMcpConfigured(mcpConfig)) return false
    return mcpConfig.type === "remote" && mcpConfig.oauth !== false
  }

  async function hasStoredTokensImpl(mcpName: string): Promise<boolean> {
    const entry = await runMcpAuth(
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        return yield* auth.get(mcpName)
      }),
    )
    return !!entry?.tokens
  }

  export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

  async function getAuthStatusImpl(mcpName: string): Promise<AuthStatus> {
    const hasTokens = await hasStoredTokensImpl(mcpName)
    if (!hasTokens) return "not_authenticated"
    const expired = await runMcpAuth(
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        return yield* auth.isTokenExpired(mcpName)
      }),
    )
    return expired ? "expired" : "authenticated"
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const scopedState = yield* state
      const getState = InstanceState.get(scopedState)

      const add = Effect.fn("MCP.add")(function* (name: string, mcp: Config.Mcp) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => addImpl(s, name, mcp))
      })

      const status = Effect.fn("MCP.status")(function* () {
        const s = yield* getState
        return yield* Effect.tryPromise(() => statusImpl(s))
      })

      const clients = Effect.fn("MCP.clients")(function* () {
        const s = yield* getState
        return yield* Effect.tryPromise(() => clientsImpl(s))
      })

      const connect = Effect.fn("MCP.connect")(function* (name: string) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => connectImpl(s, name))
      })

      const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => disconnectImpl(s, name))
      })

      const tools = Effect.fn("MCP.tools")(function* () {
        const s = yield* getState
        return yield* Effect.tryPromise(() => toolsImpl(s))
      })

      const prompts = Effect.fn("MCP.prompts")(function* () {
        const s = yield* getState
        return yield* Effect.tryPromise(() => promptsImpl(s))
      })

      const resources = Effect.fn("MCP.resources")(function* () {
        const s = yield* getState
        return yield* Effect.tryPromise(() => resourcesImpl(s))
      })

      const getPrompt = Effect.fn("MCP.getPrompt")(function* (
        clientName: string,
        name: string,
        args?: Record<string, string>,
      ) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => getPromptImpl(s, clientName, name, args))
      })

      const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => readResourceImpl(s, clientName, resourceUri))
      })

      const startAuth = Effect.fn("MCP.startAuth")(function* (mcpName: string) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => startAuthImpl(s, mcpName))
      })

      const authenticate = Effect.fn("MCP.authenticate")(function* (mcpName: string) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => authenticateImpl(s, mcpName))
      })

      const finishAuth = Effect.fn("MCP.finishAuth")(function* (mcpName: string, authorizationCode: string) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => finishAuthImpl(s, mcpName, authorizationCode))
      })

      const removeAuth = Effect.fn("MCP.removeAuth")(function* (mcpName: string) {
        return yield* Effect.tryPromise(() => removeAuthImpl(mcpName))
      })

      const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (mcpName: string) {
        const s = yield* getState
        return yield* Effect.tryPromise(() => supportsOAuthImpl(s, mcpName))
      })

      const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (mcpName: string) {
        return yield* Effect.tryPromise(() => hasStoredTokensImpl(mcpName))
      })

      const getAuthStatus = Effect.fn("MCP.getAuthStatus")(function* (mcpName: string) {
        return yield* Effect.tryPromise(() => getAuthStatusImpl(mcpName))
      })

      return Service.of({
        add,
        status,
        clients,
        connect,
        disconnect,
        tools,
        prompts,
        resources,
        getPrompt,
        readResource,
        startAuth,
        authenticate,
        finishAuth,
        removeAuth,
        supportsOAuth,
        hasStoredTokens,
        getAuthStatus,
      })
    }),
  )

  export const defaultLayer = layer
}
