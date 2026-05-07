import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"

export namespace McpHttpApi {
  const NamePath = Schema.Struct({
    name: Schema.String,
  })

  const McpOAuth = Schema.Struct({
    clientId: Schema.optional(Schema.String),
    clientSecret: Schema.optional(Schema.String),
    scope: Schema.optional(Schema.String),
  })

  const McpLocal = Schema.Struct({
    type: Schema.Literal("local"),
    command: Schema.Array(Schema.String),
    environment: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
    enabled: Schema.optional(Schema.Boolean),
    timeout: Schema.optional(Schema.Number),
  })

  const McpRemote = Schema.Struct({
    type: Schema.Literal("remote"),
    url: Schema.String,
    enabled: Schema.optional(Schema.Boolean),
    headers: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
    oauth: Schema.optional(Schema.Union(McpOAuth, Schema.Literal(false))),
    timeout: Schema.optional(Schema.Number),
  })

  const McpConfig = Schema.Union(McpLocal, McpRemote).annotations({ identifier: "McpConfig" })

  const AddPayload = Schema.Struct({
    name: Schema.String,
    config: McpConfig,
  }).annotations({ identifier: "McpAddPayload" })

  const TogglePayload = Schema.Struct({
    enabled: Schema.Boolean,
  }).annotations({ identifier: "McpTogglePayload" })

  const Success = Schema.Struct({
    success: Schema.Literal(true),
  }).annotations({ identifier: "McpMutationSuccess" })

  const AuthCallbackPayload = Schema.Struct({
    code: Schema.String,
  }).annotations({ identifier: "McpAuthCallbackPayload" })

  const StartAuthResponse = Schema.Struct({
    authorizationUrl: Schema.String,
  }).annotations({ identifier: "McpStartAuthResponse" })

  const Status = Schema.Union(
    Schema.Struct({
      status: Schema.Literal("connected"),
    }),
    Schema.Struct({
      status: Schema.Literal("disabled"),
    }),
    Schema.Struct({
      status: Schema.Literal("failed"),
      error: Schema.String,
    }),
    Schema.Struct({
      status: Schema.Literal("needs_auth"),
    }),
    Schema.Struct({
      status: Schema.Literal("needs_client_registration"),
      error: Schema.String,
    }),
  ).annotations({ identifier: "MCPStatus" })

  const StatusMap = Schema.Record({ key: Schema.String, value: Status }).annotations({ identifier: "MCPStatusMap" })
  type StatusMap = typeof StatusMap.Type

  function isMcpStatus(value: Record<string, MCP.Status> | MCP.Status): value is MCP.Status {
    return (
      typeof value === "object" &&
      value !== null &&
      "status" in value &&
      typeof (value as { status?: unknown }).status === "string"
    )
  }

  function normalizeStatusMap(name: string, value: Record<string, MCP.Status> | MCP.Status): StatusMap {
    return (isMcpStatus(value) ? { [name]: value } : value) as StatusMap
  }

  export const Group = HttpApiGroup.make("mcp")
    .add(HttpApiEndpoint.get("status", "/").addSuccess(StatusMap))
    .add(HttpApiEndpoint.post("add", "/").setPayload(AddPayload).addSuccess(StatusMap))
    .add(HttpApiEndpoint.post("startAuth", "/:name/auth").setPath(NamePath).addSuccess(StartAuthResponse))
    .add(
      HttpApiEndpoint.post("authCallback", "/:name/auth/callback")
        .setPath(NamePath)
        .setPayload(AuthCallbackPayload)
        .addSuccess(Status),
    )
    .add(HttpApiEndpoint.post("authenticate", "/:name/auth/authenticate").setPath(NamePath).addSuccess(Status))
    .add(HttpApiEndpoint.del("removeAuth", "/:name/auth").setPath(NamePath).addSuccess(Success))
    .add(HttpApiEndpoint.post("connect", "/:name/connect").setPath(NamePath).addSuccess(Schema.Boolean))
    .add(HttpApiEndpoint.post("disconnect", "/:name/disconnect").setPath(NamePath).addSuccess(Schema.Boolean))
    .add(
      HttpApiEndpoint.post("toggle", "/:name/toggle")
        .setPath(NamePath)
        .setPayload(TogglePayload)
        .addSuccess(StatusMap),
    )
    .prefix("/mcp")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.api(Api)

  export const handlers = {
    status: () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        return yield* mcp.status()
      }).pipe(Effect.orDie),
    add: ({ payload }: { payload: typeof AddPayload.Type }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        const result = yield* mcp.add(payload.name, payload.config as Config.Mcp)
        return normalizeStatusMap(payload.name, result.status)
      }).pipe(Effect.orDie),
    startAuth: ({ path }: { path: { name: string } }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        const supports = yield* mcp.supportsOAuth(path.name)
        if (!supports) {
          return yield* Effect.die(new Error(`MCP server ${path.name} does not support OAuth`))
        }
        return yield* mcp.startAuth(path.name)
      }).pipe(Effect.orDie),
    authCallback: ({
      path,
      payload,
    }: {
      path: { name: string }
      payload: typeof AuthCallbackPayload.Type
    }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        return yield* mcp.finishAuth(path.name, payload.code)
      }).pipe(Effect.orDie),
    authenticate: ({ path }: { path: { name: string } }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        const supports = yield* mcp.supportsOAuth(path.name)
        if (!supports) {
          return yield* Effect.die(new Error(`MCP server ${path.name} does not support OAuth`))
        }
        return yield* mcp.authenticate(path.name)
      }).pipe(Effect.orDie),
    removeAuth: ({ path }: { path: { name: string } }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        yield* mcp.removeAuth(path.name)
        return { success: true as const }
      }).pipe(Effect.orDie),
    connect: ({ path }: { path: { name: string } }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        yield* mcp.connect(path.name)
        return true
      }).pipe(Effect.orDie),
    disconnect: ({ path }: { path: { name: string } }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        yield* mcp.disconnect(path.name)
        return true
      }).pipe(Effect.orDie),
    toggle: ({ path, payload }: { path: { name: string }; payload: typeof TogglePayload.Type }) =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        yield* config.update({ mcp: { [path.name]: { enabled: payload.enabled } } })
        if (!payload.enabled) {
          const mcp = yield* MCP.Service
          yield* mcp.disconnect(path.name)
        }
        const mcp = yield* MCP.Service
        return yield* mcp.status()
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "mcp", (builder) =>
    builder
      .handle("status", () => handlers.status())
      .handle("add", (request) => handlers.add(request))
      .handle("startAuth", (request) => handlers.startAuth(request))
      .handle("authCallback", (request) => handlers.authCallback(request))
      .handle("authenticate", (request) => handlers.authenticate(request))
      .handle("removeAuth", (request) => handlers.removeAuth(request))
      .handle("connect", (request) => handlers.connect(request))
      .handle("disconnect", (request) => handlers.disconnect(request))
      .handle("toggle", (request) => handlers.toggle(request)),
  )

  export const DependenciesLive = Layer.mergeAll(MCP.defaultLayer, Config.defaultLayer) as Layer.Layer<
    MCP.Service | Config.Service,
    never,
    never
  >

  export const layer = ApiLive.pipe(
    Layer.provide(HandlersLive),
    Layer.provide(DependenciesLive),
  )
}
