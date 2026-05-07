import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { InstanceState } from "@/effect"
import { Workspace } from "@/workspace"

export namespace WorkspaceHttpApi {
  const AdaptorInfo = Schema.Struct({
    type: Schema.String,
    name: Schema.String,
    description: Schema.String,
    available: Schema.optional(Schema.Boolean),
  }).annotations({ identifier: "WorkspaceAdaptorInfo" })

  const WorkspaceConfig = Schema.Union(
    Schema.Struct({
      type: Schema.Literal("worktree"),
      directory: Schema.String,
      eventLimit: Schema.optional(Schema.Number),
    }),
    Schema.Struct({
      type: Schema.Literal("container"),
      directory: Schema.String,
      runtime: Schema.Literal("docker", "podman"),
      image: Schema.String,
      containerName: Schema.String,
      port: Schema.Number,
      serverUrl: Schema.String,
      eventLimit: Schema.optional(Schema.Number),
    }),
  ).annotations({ identifier: "WorkspaceConfig" })

  const WorkspaceInfo = Schema.Struct({
    id: Schema.String,
    branch: Schema.NullOr(Schema.String),
    projectID: Schema.String,
    config: WorkspaceConfig,
  }).annotations({ identifier: "Workspace" })
  const OptionalWorkspaceInfo = Schema.Union(WorkspaceInfo, Schema.Null).annotations({
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
  }).annotations({ identifier: "WorkspaceCreateInput" })
  const RestoreQuery = Schema.Struct({
    timeoutMs: Schema.optional(Schema.NumberFromString),
  })
  const RestorePayload = Schema.Struct({
    workspaceID: Schema.String,
    sessions: Schema.Array(Schema.String),
    events: Schema.Array(Schema.Unknown),
  }).annotations({ identifier: "WorkspaceRestore" })
  const SessionRestorePayload = Schema.Struct({
    workspaceID: Schema.String,
    sessionID: Schema.String,
    sessions: Schema.Array(Schema.String),
    events: Schema.Array(Schema.Unknown),
  }).annotations({ identifier: "WorkspaceSessionRestore" })

  export const Group = HttpApiGroup.make("workspace")
    .add(HttpApiEndpoint.get("adaptors", "/adaptor").addSuccess(Schema.Array(AdaptorInfo)))
    .add(
      HttpApiEndpoint.post("create", "/:id")
        .setPath(WorkspacePath)
        .setPayload(CreatePayload)
        .addSuccess(WorkspaceInfo),
    )
    .add(HttpApiEndpoint.get("list", "/").addSuccess(Schema.Array(WorkspaceInfo)))
    .add(HttpApiEndpoint.del("remove", "/:id").setPath(WorkspacePath).addSuccess(OptionalWorkspaceInfo))
    .add(
      HttpApiEndpoint.post("restore", "/:id/restore")
        .setPath(WorkspacePath)
        .setUrlParams(RestoreQuery)
        .addSuccess(RestorePayload),
    )
    .add(
      HttpApiEndpoint.post("sessionRestore", "/:id/session/:sessionID/restore")
        .setPath(SessionRestorePath)
        .setUrlParams(RestoreQuery)
        .addSuccess(SessionRestorePayload),
    )
    .prefix("/experimental/workspace")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.api(Api)

  export const handlers = {
    adaptors: () =>
      Effect.succeed([
        { type: "worktree", name: "Worktree", description: "Create a local git worktree", available: true },
        { type: "container", name: "Container", description: "Docker/Podman container", available: true },
      ]),
    list: () =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        return yield* Effect.promise(() => Workspace.list(ctx.project))
      }).pipe(Effect.orDie),
    create: ({ path, payload }: { path: typeof WorkspacePath.Type; payload: typeof CreatePayload.Type }) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        return yield* Effect.promise(() =>
          Workspace.create({
            id: path.id,
            projectID: ctx.project.id,
            branch: payload.branch,
            config: payload.config,
          }),
        )
      }).pipe(Effect.orDie),
    remove: ({ path }: { path: typeof WorkspacePath.Type }) =>
      Effect.promise(() => Workspace.remove(path.id).then((workspace) => workspace ?? null)).pipe(Effect.orDie),
    restore: ({ path, urlParams }: { path: typeof WorkspacePath.Type; urlParams: typeof RestoreQuery.Type }) =>
      Effect.promise(() =>
        Workspace.restore({
          workspaceID: path.id,
          timeoutMs: urlParams.timeoutMs ?? 30_000,
        }),
      ).pipe(Effect.orDie),
    sessionRestore: ({
      path,
      urlParams,
    }: {
      path: typeof SessionRestorePath.Type
      urlParams: typeof RestoreQuery.Type
    }) =>
      Effect.promise(() =>
        Workspace.sessionRestore({
          workspaceID: path.id,
          sessionID: path.sessionID,
          timeoutMs: urlParams.timeoutMs ?? 30_000,
        }),
      ).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "workspace", (builder) =>
    builder
      .handle("adaptors", () => handlers.adaptors())
      .handle("create", (request) => handlers.create(request))
      .handle("list", () => handlers.list())
      .handle("remove", (request) => handlers.remove(request))
      .handle("restore", (request) => handlers.restore(request))
      .handle("sessionRestore", (request) => handlers.sessionRestore(request)),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive))
}
