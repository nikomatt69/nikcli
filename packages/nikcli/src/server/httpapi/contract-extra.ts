import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Schema } from "effect"
import { Auth } from "@/auth"

/**
 * Contract-only Effect groups for routes that Hono still serves and that do
 * not belong to any served `PublicHttpApi.Api` group. They are added to
 * `PublicApi` (the generation contract) so the OpenAPI/SDK surface generated
 * from Effect matches the Hono one 1:1 — see `SyncHttpApi` for the pattern.
 *
 * `OpenApi.Identifier` pins each operationId to the value the Hono OpenAPI
 * emits (including the auto-generated ids of routes without `describeRoute`,
 * e.g. `postConfigMcp`), so the SDK class tree is identical regardless of
 * which backend produced the spec.
 */
export namespace ContractExtraHttpApi {
  const SuccessFlag = Schema.Struct({
    success: Schema.Boolean,
  }).annotate({ identifier: "SuccessFlag" })

  // --- /auth/:providerID — legacy provider credential store (server.ts) ---

  const ProviderPath = Schema.Struct({
    providerID: Schema.String,
  })

  export const AuthGroup = HttpApiGroup.make("auth")
    .add(
      HttpApiEndpoint.put("set", "/:providerID", {
        params: ProviderPath,
        payload: Auth.InfoSchema,
        success: Schema.Boolean,
      }).annotate(OpenApi.Identifier, "auth.set"),
    )
    .add(
      HttpApiEndpoint.delete("remove", "/:providerID", {
        params: ProviderPath,
        success: Schema.Boolean,
      }).annotate(OpenApi.Identifier, "auth.remove"),
    )
    .prefix("/auth")

  // --- /config extras — MCP CRUD, profiles, reload (routes/config.ts) ---

  const NamePath = Schema.Struct({
    name: Schema.String,
  })

  const McpAddPayload = Schema.Struct({
    name: Schema.String,
    config: Schema.Unknown.annotate({
      description: "MCP server configuration (Config.Mcp)",
    }),
  }).annotate({ identifier: "ConfigMcpAddInput" })

  const ReloadResponse = Schema.Struct({
    reloaded: Schema.Boolean,
    directory: Schema.String,
  }).annotate({ identifier: "ConfigReloadResponse" })

  export const ConfigManagementGroup = HttpApiGroup.make("config-management")
    .add(
      HttpApiEndpoint.post("reload", "/reload", {
        success: ReloadResponse,
      }).annotate(OpenApi.Identifier, "config.reload"),
    )
    .add(
      HttpApiEndpoint.post("mcpAdd", "/mcp", {
        payload: McpAddPayload,
        success: SuccessFlag,
      }).annotate(OpenApi.Identifier, "postConfigMcp"),
    )
    .add(
      HttpApiEndpoint.patch("mcpUpdate", "/mcp/:name", {
        params: NamePath,
        payload: Schema.Record(Schema.String, Schema.Unknown),
        success: SuccessFlag,
      }).annotate(OpenApi.Identifier, "patchConfigMcp:name"),
    )
    .add(
      HttpApiEndpoint.delete("mcpRemove", "/mcp/:name", {
        params: NamePath,
        success: SuccessFlag,
      }).annotate(OpenApi.Identifier, "deleteConfigMcp:name"),
    )
    .add(
      HttpApiEndpoint.post("profileCreate", "/profiles", {
        payload: Schema.Struct({ name: Schema.String }),
        success: SuccessFlag,
      }).annotate(OpenApi.Identifier, "postConfigProfiles"),
    )
    .add(
      HttpApiEndpoint.post("profileActivate", "/profiles/activate/:name", {
        params: NamePath,
        success: SuccessFlag,
      }).annotate(OpenApi.Identifier, "postConfigProfilesActivate:name"),
    )
    .prefix("/config")

  // --- /session prompt — raw streaming routes served by the bridge specials
  // (`HttpApiPrompt`), schema-described here for the SDK contract. ---

  const SessionIDPath = Schema.Struct({
    sessionID: Schema.String,
  })

  /**
   * Top level of `SessionPrompt.PromptInput` (minus `sessionID`); the part
   * union stays opaque until MessageV2 gets Effect schemas (schema split).
   */
  const PromptPayload = Schema.Struct({
    messageID: Schema.optional(Schema.String),
    model: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
      }),
    ),
    agent: Schema.optional(Schema.String),
    noReply: Schema.optional(Schema.Boolean),
    tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
    format: Schema.optional(Schema.Unknown),
    system: Schema.optional(Schema.String),
    variant: Schema.optional(Schema.String),
    parts: Schema.Array(Schema.Unknown),
  }).annotate({ identifier: "SessionPromptInput" })

  const PromptResponse = Schema.Unknown.annotate({
    identifier: "SessionPromptResponse",
    description: "{ info: AssistantMessage, parts: Part[] }",
  })

  export const SessionPromptGroup = HttpApiGroup.make("session-prompt")
    .add(
      HttpApiEndpoint.post("prompt", "/:sessionID/message", {
        params: SessionIDPath,
        payload: PromptPayload,
        success: PromptResponse,
      }).annotate(OpenApi.Identifier, "session.prompt"),
    )
    .add(
      HttpApiEndpoint.post("promptAsync", "/:sessionID/prompt_async", {
        params: SessionIDPath,
        payload: PromptPayload,
        success: HttpApiSchema.NoContent,
      }).annotate(OpenApi.Identifier, "session.prompt_async"),
    )
    .prefix("/session")

  // --- share — public share pages/data (server.ts) ---

  const SharePath = Schema.Struct({
    shareID: Schema.String,
  })

  export const ShareGroup = HttpApiGroup.make("share")
    .add(
      HttpApiEndpoint.get("short", "/s/:shareID", {
        params: SharePath,
        success: Schema.Unknown.annotate({ description: "308 redirect to /share/:shareID" }),
      }).annotate(OpenApi.Identifier, "getS:shareID"),
    )
    .add(
      HttpApiEndpoint.get("page", "/share/:shareID", {
        params: SharePath,
        success: Schema.Unknown,
      }).annotate(OpenApi.Identifier, "getShare:shareID"),
    )
    .add(
      HttpApiEndpoint.get("api", "/api/share/:shareID", {
        params: SharePath,
        success: Schema.Unknown,
      }).annotate(OpenApi.Identifier, "getApiShare:shareID"),
    )
    .add(
      HttpApiEndpoint.get("data", "/api/share/:shareID/data", {
        params: SharePath,
        success: Schema.Unknown,
      }).annotate(OpenApi.Identifier, "getApiShare:shareIDData"),
    )

  // --- SSE event feeds — served raw by the bridge specials (`HttpApiEvent`);
  // the instance feed emits plain {type, properties}, the global feed wraps
  // them in {directory, payload}. Data stays opaque until Bus events get
  // Effect schemas (schema split). ---

  export const EventsGroup = HttpApiGroup.make("events")
    .add(
      HttpApiEndpoint.get("subscribe", "/event", {
        success: HttpApiSchema.StreamSse({ data: Schema.Unknown }),
      }).annotate(OpenApi.Identifier, "event.subscribe"),
    )
    .add(
      HttpApiEndpoint.get("global", "/global/event", {
        success: HttpApiSchema.StreamSse({ data: Schema.Unknown }),
      }).annotate(OpenApi.Identifier, "global.event"),
    )

  // --- experimental/workspace extras (routes/workspace.ts) ---

  const WorkspaceIDPath = Schema.Struct({
    id: Schema.String,
  })

  const JournalEvent = Schema.Unknown.annotate({
    identifier: "WorkspaceJournalEvent",
  })

  const SessionWarpPayload = Schema.Struct({
    workspaceID: Schema.NullOr(Schema.String),
    copyChanges: Schema.optional(Schema.Boolean),
    timeoutMs: Schema.optional(Schema.Number),
  }).annotate({ identifier: "WorkspaceSessionWarpInput" })

  const SessionWarpResponse = Schema.Struct({
    sessionID: Schema.String,
    workspaceID: Schema.NullOr(Schema.String),
  }).annotate({ identifier: "WorkspaceSessionWarpResponse" })

  export const WorkspaceExtraGroup = HttpApiGroup.make("workspace-extra")
    .add(
      HttpApiEndpoint.get("events", "/:id/events", {
        params: WorkspaceIDPath,
        query: Schema.Struct({
          from: Schema.optional(Schema.NumberFromString),
        }),
        success: Schema.Array(JournalEvent),
      }).annotate(OpenApi.Identifier, "experimental.workspace.events"),
    )
    .add(
      HttpApiEndpoint.post("sessionWarp", "/session/:sessionID/warp", {
        params: SessionIDPath,
        payload: SessionWarpPayload,
        success: SessionWarpResponse,
      }).annotate(OpenApi.Identifier, "experimental.workspace.session.warp"),
    )
    .prefix("/experimental/workspace")

  // --- /user/* — instance-less account routes. Served raw by `UsersHttp`
  // (the shared `{ error }` body cannot round-trip the HttpApi error
  // encoder), described here for the SDK contract only. ---

  export const UsersGroup = HttpApiGroup.make("users")
    .add(
      HttpApiEndpoint.post("register", "/user/register", {
        payload: Schema.Struct({
          username: Schema.String,
          email: Schema.String,
          password: Schema.String,
          displayName: Schema.optional(Schema.String),
        }),
        success: Schema.Unknown,
      }).annotate(OpenApi.Identifier, "postUserRegister"),
    )
    .add(
      HttpApiEndpoint.post("login", "/user/login", {
        payload: Schema.Struct({
          email: Schema.String,
          password: Schema.String,
        }),
        success: Schema.Unknown,
      }).annotate(OpenApi.Identifier, "postUserLogin"),
    )
    .add(
      HttpApiEndpoint.patch("update", "/user/:id", {
        params: Schema.Struct({ id: Schema.String }),
        payload: Schema.Struct({
          displayName: Schema.optional(Schema.String),
          password: Schema.optional(Schema.String),
          role: Schema.optional(Schema.Literals(["admin", "user"])),
        }),
        success: Schema.Unknown,
      }).annotate(OpenApi.Identifier, "patchUser:id"),
    )

  // --- pty websocket upgrade — not an HTTP transport endpoint for the
  // generated clients (omitted there), but part of the public OpenAPI. ---

  export const PtyConnectGroup = HttpApiGroup.make("pty-connect").add(
    HttpApiEndpoint.get("connect", "/pty/:ptyID/connect", {
      params: Schema.Struct({ ptyID: Schema.String }),
      success: Schema.Unknown.annotate({ description: "WebSocket upgrade" }),
    }).annotate(OpenApi.Identifier, "pty.connect"),
  )
}
