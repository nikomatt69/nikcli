import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
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
    environment: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    enabled: Schema.optional(Schema.Boolean),
    timeout: Schema.optional(Schema.Number),
  })

  const McpRemote = Schema.Struct({
    type: Schema.Literal("remote"),
    url: Schema.String,
    enabled: Schema.optional(Schema.Boolean),
    headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    oauth: Schema.optional(Schema.Union([McpOAuth, Schema.Literal(false)])),
    timeout: Schema.optional(Schema.Number),
  })

  const McpConfig = Schema.Union([McpLocal, McpRemote]).annotate({ identifier: "McpConfig" })

  const AddPayload = Schema.Struct({
    name: Schema.String,
    config: McpConfig,
  }).annotate({ identifier: "McpAddPayload" })

  const TogglePayload = Schema.Struct({
    enabled: Schema.Boolean,
  }).annotate({ identifier: "McpTogglePayload" })

  const Success = Schema.Struct({
    success: Schema.Literal(true),
  }).annotate({ identifier: "McpMutationSuccess" })

  const AuthCallbackPayload = Schema.Struct({
    code: Schema.String,
  }).annotate({ identifier: "McpAuthCallbackPayload" })

  const StartAuthResponse = Schema.Struct({
    authorizationUrl: Schema.String,
  }).annotate({ identifier: "McpStartAuthResponse" })

  const Status = Schema.Union([
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
  ]).annotate({ identifier: "MCPStatus" })

  const StatusMap = Schema.Record(Schema.String, Status).annotate({ identifier: "MCPStatusMap" })
  type StatusMap = typeof StatusMap.Type

  /** Declared 400 for OAuth flows on servers without OAuth support —
   * mirrors the legacy Hono `{ error }` body. */
  const OAuthUnsupported = Schema.Struct({
    error: Schema.String,
  }).annotate({ identifier: "McpOAuthUnsupportedError", httpApiStatus: 400 })

  const oauthUnsupported = (name: string) => ({ error: `MCP server ${name} does not support OAuth` })

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
    .add(HttpApiEndpoint.get("status", "/", { success: StatusMap }))
    .add(HttpApiEndpoint.post("add", "/", { payload: AddPayload, success: StatusMap }))
    .add(
      HttpApiEndpoint.post("startAuth", "/:name/auth", {
        params: NamePath,
        success: StartAuthResponse,
        error: OAuthUnsupported,
      }).annotate(OpenApi.Identifier, "mcp.auth.start"),
    )
    .add(
      HttpApiEndpoint.post("authCallback", "/:name/auth/callback", {
        params: NamePath,
        payload: AuthCallbackPayload,
        success: Status,
      }).annotate(OpenApi.Identifier, "mcp.auth.callback"),
    )
    .add(
      HttpApiEndpoint.post("authenticate", "/:name/auth/authenticate", {
        params: NamePath,
        success: Status,
        error: OAuthUnsupported,
      }).annotate(OpenApi.Identifier, "mcp.auth.authenticate"),
    )
    .add(
      HttpApiEndpoint.delete("removeAuth", "/:name/auth", { params: NamePath, success: Success }).annotate(
        OpenApi.Identifier,
        "mcp.auth.remove",
      ),
    )
    .add(HttpApiEndpoint.post("connect", "/:name/connect", { params: NamePath, success: Schema.Boolean }))
    .add(HttpApiEndpoint.post("disconnect", "/:name/disconnect", { params: NamePath, success: Schema.Boolean }))
    .add(
      HttpApiEndpoint.post("toggle", "/:name/toggle", {
        params: NamePath,
        payload: TogglePayload,
        success: StatusMap,
      }),
    )
    .prefix("/mcp")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

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
    startAuth: ({ params }: { params: { name: string } }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        const supports = yield* Effect.orDie(mcp.supportsOAuth(params.name))
        if (!supports) {
          // expected failure, not a defect: the declared 400 contract
          return yield* Effect.fail(oauthUnsupported(params.name))
        }
        return yield* Effect.orDie(mcp.startAuth(params.name))
      }),
    authCallback: ({ params, payload }: { params: { name: string }; payload: typeof AuthCallbackPayload.Type }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        return yield* mcp.finishAuth(params.name, payload.code)
      }).pipe(Effect.orDie),
    authenticate: ({ params }: { params: { name: string } }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        const supports = yield* Effect.orDie(mcp.supportsOAuth(params.name))
        if (!supports) {
          // expected failure, not a defect: the declared 400 contract
          return yield* Effect.fail(oauthUnsupported(params.name))
        }
        return yield* Effect.orDie(mcp.authenticate(params.name))
      }),
    removeAuth: ({ params }: { params: { name: string } }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        yield* mcp.removeAuth(params.name)
        return { success: true as const }
      }).pipe(Effect.orDie),
    connect: ({ params }: { params: { name: string } }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        yield* mcp.connect(params.name)
        return true
      }).pipe(Effect.orDie),
    disconnect: ({ params }: { params: { name: string } }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        yield* mcp.disconnect(params.name)
        return true
      }).pipe(Effect.orDie),
    toggle: ({ params, payload }: { params: { name: string }; payload: typeof TogglePayload.Type }) =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        yield* config.update({ mcp: { [params.name]: { enabled: payload.enabled } } })
        if (!payload.enabled) {
          const mcp = yield* MCP.Service
          yield* mcp.disconnect(params.name)
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

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
