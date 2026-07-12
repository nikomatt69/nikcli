import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { InstanceState } from "@/effect"
import { Workspace } from "@/workspace"
import { listAdaptors } from "@/workspace/adaptors"

export namespace WorkspaceHttpApi {
  const AdaptorInfo = Schema.Struct({
    type: Schema.String,
    name: Schema.String,
    description: Schema.String,
    available: Schema.optional(Schema.Boolean),
  }).annotate({ identifier: "WorkspaceAdaptorInfo" })

  const WorkspaceConfig = Schema.Union([
    Schema.Struct({
      type: Schema.Literal("worktree"),
      directory: Schema.String,
      strategy: Schema.optional(Schema.Literals(["git", "cow"])),
      eventLimit: Schema.optional(Schema.Number),
    }),
    Schema.Struct({
      type: Schema.Literal("container"),
      directory: Schema.String,
      runtime: Schema.Literals(["docker", "podman"]),
      image: Schema.String,
      containerName: Schema.String,
      port: Schema.Number,
      serverUrl: Schema.String,
      eventLimit: Schema.optional(Schema.Number),
    }),
    Schema.Struct({
      type: Schema.Literal("branch"),
      directory: Schema.String,
      branch: Schema.optional(Schema.String),
      eventLimit: Schema.optional(Schema.Number),
    }),
  ]).annotate({ identifier: "WorkspaceConfig" })

  const WorkspaceInfo = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    timeUsed: Schema.Number,
    branch: Schema.NullOr(Schema.String),
    projectID: Schema.String,
    config: WorkspaceConfig,
  }).annotate({ identifier: "Workspace" })
  const OptionalWorkspaceInfo = Schema.Union([WorkspaceInfo, Schema.Null]).annotate({
    identifier: "OptionalWorkspace",
  })
  const WorkspacePath = Schema.Struct({
    id: Schema.String,
  })
  const SessionRestorePath = Schema.Struct({
    id: Schema.String,
    sessionID: Schema.String,
  })
  const CreatePayload = Schema.Struct({
    branch: Schema.NullOr(Schema.String),
    config: WorkspaceConfig,
  }).annotate({ identifier: "WorkspaceCreateInput" })
  const RestoreQuery = Schema.Struct({
    timeoutMs: Schema.optional(Schema.NumberFromString),
  })
  const RestorePayload = Schema.Struct({
    workspaceID: Schema.String,
    sessions: Schema.Array(Schema.String),
    events: Schema.Array(Schema.Unknown),
  }).annotate({ identifier: "WorkspaceRestore" })
  const SessionRestorePayload = Schema.Struct({
    workspaceID: Schema.String,
    sessionID: Schema.String,
    sessions: Schema.Array(Schema.String),
    events: Schema.Array(Schema.Unknown),
  }).annotate({ identifier: "WorkspaceSessionRestore" })
  const WarpPayload = Schema.Struct({
    id: Schema.NullOr(Schema.String),
    sessionID: Schema.String,
    copyChanges: Schema.optional(Schema.Boolean),
    timeoutMs: Schema.optional(Schema.Number),
  }).annotate({ identifier: "WorkspaceWarpInput" })
  const ConnectionStatus = Schema.Struct({
    workspaceID: Schema.String,
    status: Schema.Literals(["connected", "connecting", "disconnected", "error"]),
  }).annotate({ identifier: "WorkspaceConnectionStatus" })

  export const Group = HttpApiGroup.make("workspace")
    .add(
      HttpApiEndpoint.get("adaptors", "/adaptor", {
        success: Schema.Array(AdaptorInfo),
      }),
    )
    .add(
      HttpApiEndpoint.post("syncList", "/sync-list", {
        success: HttpApiSchema.NoContent,
      }),
    )
    .add(
      HttpApiEndpoint.get("status", "/status", {
        success: Schema.Array(ConnectionStatus),
      }),
    )
    .add(
      HttpApiEndpoint.post("create", "/:id", {
        params: WorkspacePath,
        payload: CreatePayload,
        success: WorkspaceInfo,
      }),
    )
    .add(
      HttpApiEndpoint.get("list", "/", {
        success: Schema.Array(WorkspaceInfo),
      }),
    )
    .add(
      HttpApiEndpoint.delete("remove", "/:id", {
        params: WorkspacePath,
        success: OptionalWorkspaceInfo,
      }),
    )
    .add(
      HttpApiEndpoint.post("restore", "/:id/restore", {
        params: WorkspacePath,
        query: RestoreQuery,
        success: RestorePayload,
      }),
    )
    .add(
      HttpApiEndpoint.post("sessionRestore", "/:id/session/:sessionID/restore", {
        params: SessionRestorePath,
        query: RestoreQuery,
        success: SessionRestorePayload,
      }),
    )
    .add(
      HttpApiEndpoint.post("warp", "/warp", {
        payload: WarpPayload,
        success: HttpApiSchema.NoContent,
      }),
    )
    .prefix("/experimental/workspace")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    adaptors: () =>
      Effect.sync(() =>
        listAdaptors().map(({ type, adaptor }) => ({
          type,
          name: adaptor.name,
          description: adaptor.description,
          available: true,
        })),
      ),
    syncList: () =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        yield* Effect.promise(() => Workspace.syncList(ctx.project))
      }).pipe(Effect.asVoid, Effect.orDie),
    status: () =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        return yield* Effect.promise(() => Workspace.statuses(ctx.project))
      }).pipe(Effect.orDie),
    list: () =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        return yield* Effect.promise(() => Workspace.list(ctx.project))
      }).pipe(Effect.orDie),
    create: ({ params, payload }: { params: typeof WorkspacePath.Type; payload: typeof CreatePayload.Type }) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        return yield* Effect.promise(() =>
          Workspace.create({
            id: params.id,
            projectID: ctx.project.id,
            branch: payload.branch,
            config: payload.config,
          }),
        )
      }).pipe(Effect.orDie),
    remove: ({ params }: { params: typeof WorkspacePath.Type }) =>
      Effect.promise(() => Workspace.remove(params.id).then((workspace) => workspace ?? null)).pipe(Effect.orDie),
    restore: ({ params, query }: { params: typeof WorkspacePath.Type; query: typeof RestoreQuery.Type }) =>
      Effect.promise(() =>
        Workspace.restore({
          workspaceID: params.id,
          timeoutMs: query.timeoutMs ?? 30_000,
        }),
      ).pipe(
        Effect.map((result) => ({
          ...result,
          events: result.events ?? [],
          sessions: result.sessions ?? [],
        })),
        Effect.orDie,
      ),
    sessionRestore: ({ params, query }: { params: typeof SessionRestorePath.Type; query: typeof RestoreQuery.Type }) =>
      Effect.promise(() =>
        Workspace.sessionRestore({
          workspaceID: params.id,
          sessionID: params.sessionID,
          timeoutMs: query.timeoutMs ?? 30_000,
        }),
      ).pipe(
        Effect.map((result) => ({
          ...result,
          events: result.events ?? [],
          sessions: result.sessions ?? [],
        })),
        Effect.orDie,
      ),
    warp: ({ payload }: { payload: typeof WarpPayload.Type }) =>
      Effect.promise(() =>
        Workspace.sessionWarp({
          workspaceID: payload.id,
          sessionID: payload.sessionID,
          copyChanges: payload.copyChanges,
          timeoutMs: payload.timeoutMs ?? 30_000,
        }),
      ).pipe(Effect.asVoid, Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "workspace", (builder) =>
    builder
      .handle("adaptors", () => handlers.adaptors())
      .handle("syncList", () => handlers.syncList())
      .handle("status", () => handlers.status())
      .handle("create", (request) => handlers.create(request))
      .handle("list", () => handlers.list())
      .handle("remove", (request) => handlers.remove(request))
      .handle("restore", (request) => handlers.restore(request))
      .handle("sessionRestore", (request) => handlers.sessionRestore(request))
      .handle("warp", (request) => handlers.warp(request)),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive))
}
