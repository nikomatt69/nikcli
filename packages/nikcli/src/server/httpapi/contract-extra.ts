import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Auth } from "@/auth"
// Side-effect import: registers every BusEvent so BusEvent.schemas() is complete.
import "@/bus/all-events"
import { BusEvent } from "@/bus/bus-event"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session"
import { Snapshot } from "@/snapshot"
import { Config } from "@/config/config"
import { InstanceState, runPromiseWithLayer } from "@/effect"
import { Instance } from "@/project/instance"
import { InstanceReload } from "@/project/reload"
import { Provider } from "@/provider/provider"
import { ShareNext } from "@/share/share-next"
import { Workspace } from "@/workspace"
import { HttpApiEvent } from "./event"
import { HttpApiPrompt } from "./prompt"
import { UsersHttp } from "./users"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Contract-only Effect groups for routes served as raw Request/Response
 * handlers and that do not belong to any served `PublicHttpApi.Api` group.
 * They are added to `PublicApi` (the generation contract) so the OpenAPI/SDK
 * surface stays complete — see `SyncHttpApi` for the pattern.
 *
 * `OpenApi.Identifier` pins each operationId to the historical SDK names
 * (including auto-generated ids such as `postConfigMcp`).
 */
export namespace ContractExtraHttpApi {
  const PROFILE_NAME = /^[a-zA-Z0-9._-]+$/

  /** Drop session-owned keys and make `id` optional — mirrors zod PromptInput parts. */
  function promptPartInput<S extends Schema.Struct.Fields, Id extends string>(
    schema: Schema.Struct<S>,
    identifier: Id,
  ) {
    return schema
      .mapFields((fields) => {
        const {
          messageID: _m,
          sessionID: _s,
          id,
          ...rest
        } = fields as S & {
          messageID?: Schema.Top
          sessionID?: Schema.Top
          id?: Schema.Top
        }
        return {
          ...rest,
          ...(id ? { id: Schema.optional(id) } : {}),
        } as Schema.Struct.Fields
      })
      .annotate({ identifier })
  }
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

  const TextPartInput = promptPartInput(MessageV2.TextPartSchema, "TextPartInput")
  const FilePartInput = promptPartInput(MessageV2.FilePartSchema, "FilePartInput")
  const AgentPartInput = promptPartInput(MessageV2.AgentPartSchema, "AgentPartInput")
  const SubtaskPartInput = promptPartInput(MessageV2.SubtaskPartSchema, "SubtaskPartInput")

  const PromptPartInput = Schema.Union([TextPartInput, FilePartInput, AgentPartInput, SubtaskPartInput]).annotate({
    identifier: "PromptPartInput",
    discriminator: "type",
  })

  /**
   * Top level of `SessionPrompt.PromptInput` (minus `sessionID`), using the
   * MessageV2 Effect schemas so OpenAPI emits named Part/Format components.
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
    format: Schema.optional(MessageV2.FormatSchema),
    system: Schema.optional(Schema.String),
    variant: Schema.optional(Schema.String),
    parts: Schema.Array(PromptPartInput),
  }).annotate({ identifier: "SessionPromptInput" })

  // prompt() returns `{ info: AssistantMessage, parts: Part[] }` (WithParts).
  const PromptResponse = MessageV2.WithPartsSchema.annotate({
    identifier: "SessionPromptResponse",
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

  /**
   * `ShareNext.Data` — the discriminated union stored per share item. All
   * three JSON share endpoints return `Object.values(share.items)`, so they
   * share one schema. Members reuse the services' own Effect Schemas.
   */
  const ShareData = Schema.Array(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal("session"), data: Session.InfoSchema }),
      Schema.Struct({ type: Schema.Literal("message"), data: MessageV2.InfoSchema }),
      Schema.Struct({ type: Schema.Literal("part"), data: MessageV2.PartSchema }),
      Schema.Struct({ type: Schema.Literal("session_diff"), data: Schema.Array(Snapshot.FileDiffSchema) }),
      Schema.Struct({ type: Schema.Literal("model"), data: Schema.Array(Provider.ModelSchema) }),
    ]),
  ).annotate({ identifier: "ShareData" })

  export const ShareGroup = HttpApiGroup.make("share")
    .add(
      HttpApiEndpoint.get("short", "/s/:shareID", {
        params: SharePath,
        success: Schema.Unknown.annotate({
          description: "308 redirect to /share/:shareID",
        }),
      }).annotate(OpenApi.Identifier, "getS:shareID"),
    )
    .add(
      HttpApiEndpoint.get("page", "/share/:shareID", {
        params: SharePath,
        success: ShareData,
      }).annotate(OpenApi.Identifier, "getShare:shareID"),
    )
    .add(
      HttpApiEndpoint.get("api", "/api/share/:shareID", {
        params: SharePath,
        success: ShareData,
      }).annotate(OpenApi.Identifier, "getApiShare:shareID"),
    )
    .add(
      HttpApiEndpoint.get("data", "/api/share/:shareID/data", {
        params: SharePath,
        success: ShareData,
      }).annotate(OpenApi.Identifier, "getApiShare:shareIDData"),
    )

  // --- SSE event feeds — served raw by the bridge specials (`HttpApiEvent`);
  // the instance feed emits plain {type, properties}, the global feed wraps
  // them in {directory, payload}. Typed with the full BusEvent Effect union
  // so OpenAPI emits the named `Event` component the SDK/plugin re-export. ---

  const EventSchema = BusEvent.schemas()

  const GlobalEventEnvelope = Schema.Struct({
    directory: Schema.String,
    payload: EventSchema,
  }).annotate({ identifier: "GlobalEvent" })

  export const EventsGroup = HttpApiGroup.make("events")
    .add(
      HttpApiEndpoint.get("subscribe", "/event", {
        success: HttpApiSchema.StreamSse({ data: EventSchema }),
      }).annotate(OpenApi.Identifier, "event.subscribe"),
    )
    .add(
      HttpApiEndpoint.get("global", "/global/event", {
        success: HttpApiSchema.StreamSse({ data: GlobalEventEnvelope }),
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

  /** `UserDB.PublicUser` — the stored user minus `password_hash`. */
  const PublicUser = Schema.Struct({
    id: Schema.String,
    username: Schema.String,
    email: Schema.String,
    display_name: Schema.NullOr(Schema.String),
    role: Schema.Literals(["admin", "user"]),
    created_at: Schema.Number,
    updated_at: Schema.Number,
  }).annotate({ identifier: "PublicUser" })

  const UserSession = Schema.Struct({
    token: Schema.String,
    user: PublicUser,
  }).annotate({ identifier: "UserSession" })

  export const UsersGroup = HttpApiGroup.make("users")
    .add(
      HttpApiEndpoint.post("register", "/user/register", {
        payload: Schema.Struct({
          username: Schema.String,
          email: Schema.String,
          password: Schema.String,
          displayName: Schema.optional(Schema.String),
        }),
        success: UserSession,
      }).annotate(OpenApi.Identifier, "postUserRegister"),
    )
    .add(
      HttpApiEndpoint.post("login", "/user/login", {
        payload: Schema.Struct({
          email: Schema.String,
          password: Schema.String,
        }),
        success: UserSession,
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
        success: PublicUser,
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

  export const Api = HttpApi.make("nikcli-contract-extra")
    .add(AuthGroup)
    .add(ConfigManagementGroup)
    .add(SessionPromptGroup)
    .add(ShareGroup)
    .add(EventsGroup)
    .add(WorkspaceExtraGroup)
    .add(UsersGroup)

  function raw(handler: (request: Request) => Promise<Response> | Response) {
    return ({ request }: { readonly request: HttpServerRequest.HttpServerRequest }) =>
      Effect.promise(async () => HttpServerResponse.fromWeb(await handler(request.source as Request)))
  }

  function json(body: unknown, status = 200) {
    return Response.json(body, { status })
  }

  async function body(request: Request): Promise<Record<string, unknown> | undefined> {
    const value = await request.json().catch(() => undefined)
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  }

  function profileDir() {
    return path.join(Config.managedConfigDir(), "profiles")
  }

  function profilePath(name: string) {
    return path.join(profileDir(), `${name}.json`)
  }

  function activeProfilePath() {
    return path.join(profileDir(), "active")
  }

  function profileName(value: unknown): string | undefined {
    if (typeof value !== "string") return
    const name = value.trim()
    if (!name || name === "active" || name === "default" || !PROFILE_NAME.test(name)) return
    return name
  }

  function configService<A, E>(run: (service: Config.Interface) => Effect.Effect<A, E>) {
    return Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* run(service)
    })
  }

  function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
    return runPromiseWithLayer(Config.defaultLayer, effect)
  }

  const AuthHandlersLive = HttpApiBuilder.group(Api, "auth", (handlers) =>
    handlers
      .handle("set", ({ params, payload }) =>
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          yield* auth.set(params.providerID, payload)
          const provider = yield* Provider.Service
          yield* Effect.ignore(provider.refresh())
          return true
        }).pipe(Effect.orDie),
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          yield* auth.remove(params.providerID)
          const provider = yield* Provider.Service
          yield* Effect.ignore(provider.refresh())
          return true
        }).pipe(Effect.orDie),
      ),
  )

  const ConfigHandlersLive = HttpApiBuilder.group(Api, "config-management", (handlers) =>
    handlers
      .handle("reload", () =>
        Effect.gen(function* () {
          const context = yield* InstanceState.context
          yield* Effect.promise(() => InstanceReload.reload(["api"]))
          return { reloaded: true, directory: context.directory }
        }).pipe(Effect.orDie),
      )
      .handleRaw(
        "mcpAdd",
        raw(async (request) => {
          const input = await body(request)
          const name = typeof input?.name === "string" ? input.name : ""
          const parsed = Config.Mcp.safeParse(input?.config)
          if (!name || !parsed.success) return json({ error: "Invalid MCP server configuration" }, 400)
          await runConfig(configService((service) => service.update({ mcp: { [name]: parsed.data } })))
          return json({ success: true })
        }),
      )
      .handleRaw(
        "mcpUpdate",
        raw(async (request) => {
          const name = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "")
          const patch = await body(request)
          if (!name || !patch) return json({ error: "Invalid MCP server configuration" }, 400)
          const current = await runConfig(configService((service) => service.get()))
          const existing = current.mcp?.[name]
          if (!existing) return json({ error: "MCP server not found" }, 404)
          const parsed = Config.Mcp.safeParse({ ...existing, ...patch })
          if (!parsed.success) return json({ error: "Invalid MCP server configuration" }, 400)
          await runConfig(configService((service) => service.update({ mcp: { [name]: parsed.data } })))
          return json({ success: true })
        }),
      )
      .handleRaw(
        "mcpRemove",
        raw(async (request) => {
          const name = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "")
          const current = await runConfig(configService((service) => service.get()))
          const next = { ...current.mcp }
          if (!(name in next)) return json({ error: "MCP server not found" }, 404)
          delete next[name]
          await Bun.write(
            path.join(Instance.directory, "nikcli.json"),
            JSON.stringify({ ...current, mcp: next }, null, 2),
          )
          return json({ success: true })
        }),
      )
      .handleRaw(
        "profileCreate",
        raw(async (request) => {
          const input = await body(request)
          const name = profileName(input?.name)
          if (!name)
            return json({ error: "Profile name can only contain letters, numbers, dots, underscores, and dashes" }, 400)
          await fs.mkdir(profileDir(), { recursive: true })
          const target = profilePath(name)
          if (await Bun.file(target).exists()) return json({ error: "Profile already exists" }, 409)
          const current = await runConfig(configService((service) => service.get()))
          await Bun.write(target, JSON.stringify(current, null, 2))
          return json({ success: true })
        }),
      )
      .handleRaw(
        "profileActivate",
        raw(async (request) => {
          const requested = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "").trim()
          await fs.mkdir(profileDir(), { recursive: true })
          if (requested === "default") {
            await fs.rm(activeProfilePath(), { force: true })
            return json({ success: true })
          }
          const name = profileName(requested)
          if (!name)
            return json({ error: "Profile name can only contain letters, numbers, dots, underscores, and dashes" }, 400)
          const file = Bun.file(profilePath(name))
          if (!(await file.exists())) return json({ error: "Profile not found" }, 404)
          await Bun.write(path.join(Instance.directory, "nikcli.json"), JSON.stringify(await file.json(), null, 2))
          await Bun.write(activeProfilePath(), name)
          return json({ success: true })
        }),
      ),
  )

  const PromptHandlersLive = HttpApiBuilder.group(Api, "session-prompt", (handlers) =>
    handlers
      .handleRaw(
        "prompt",
        raw((request) => {
          const id = decodeURIComponent(new URL(request.url).pathname.split("/")[2] ?? "")
          return HttpApiPrompt.prompt(request, id)
        }),
      )
      .handleRaw(
        "promptAsync",
        raw((request) => {
          const id = decodeURIComponent(new URL(request.url).pathname.split("/")[2] ?? "")
          return HttpApiPrompt.promptAsync(request, id)
        }),
      ),
  )

  const ShareHandlersLive = HttpApiBuilder.group(Api, "share", (handlers) => {
    const read = async (shareID: string) =>
      runPromiseWithLayer(
        ShareNext.defaultLayer,
        Effect.gen(function* () {
          const share = yield* ShareNext.Service
          return yield* share.publicData(shareID)
        }),
      )
    return handlers
      .handleRaw(
        "short",
        raw((request) => {
          const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "")
          return new Response(null, { status: 308, headers: { location: `/share/${encodeURIComponent(id)}` } })
        }),
      )
      .handleRaw(
        "page",
        raw(async (request) =>
          shareResponse(await read(decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? ""))),
        ),
      )
      .handleRaw(
        "api",
        raw(async (request) =>
          shareResponse(await read(decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? ""))),
        ),
      )
      .handleRaw(
        "data",
        raw(async (request) =>
          shareResponse(await read(decodeURIComponent(new URL(request.url).pathname.split("/").at(-2) ?? ""))),
        ),
      )
  })

  function shareResponse(data: unknown) {
    return data ? json(data) : new Response("Share not found", { status: 404 })
  }

  const EventsHandlersLive = HttpApiBuilder.group(Api, "events", (handlers) =>
    handlers
      .handleRaw(
        "subscribe",
        raw(() => HttpApiEvent.handleInstance()),
      )
      .handleRaw(
        "global",
        raw(() => HttpApiEvent.handle()),
      ),
  )

  const WorkspaceHandlersLive = HttpApiBuilder.group(Api, "workspace-extra", (handlers) =>
    handlers
      .handle("events", ({ params, query }) =>
        Effect.promise(() => Workspace.events({ workspaceID: params.id, from: query.from })).pipe(Effect.orDie),
      )
      .handle("sessionWarp", ({ params, payload }) =>
        Effect.promise(() =>
          Workspace.sessionWarp({
            sessionID: params.sessionID,
            workspaceID: payload.workspaceID,
            copyChanges: payload.copyChanges,
            timeoutMs: payload.timeoutMs ?? 30_000,
          }),
        ).pipe(Effect.orDie),
      ),
  )

  const UsersHandlersLive = HttpApiBuilder.group(Api, "users", (handlers) => {
    const user = raw(async (request) => (await UsersHttp.handle(request)) ?? new Response("Not Found", { status: 404 }))
    return handlers.handleRaw("register", user).handleRaw("login", user).handleRaw("update", user)
  })

  export const HandlersLive = Layer.mergeAll(
    AuthHandlersLive,
    ConfigHandlersLive,
    PromptHandlersLive,
    ShareHandlersLive.pipe(Layer.provide(ShareNext.defaultLayer)),
    EventsHandlersLive,
    WorkspaceHandlersLive,
    UsersHandlersLive,
  )

  export const DependenciesLive = Layer.mergeAll(Auth.defaultLayer, Config.defaultLayer, Provider.defaultLayer)
}
