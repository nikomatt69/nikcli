import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { InstanceState } from "@/effect"
import { Project } from "@/project/project"
import { ProjectCopy } from "@/project/copy"

export namespace ProjectHttpApi {
  const Icon = Schema.Struct({
    url: Schema.optional(Schema.String),
    override: Schema.optional(Schema.String),
    color: Schema.optional(Schema.String),
  })

  const Time = Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
    initialized: Schema.optional(Schema.Number),
  })

  export const Info = Schema.Struct({
    id: Schema.String,
    worktree: Schema.String,
    canonical: Schema.String,
    vcs: Schema.optional(Schema.Literal("git")),
    name: Schema.optional(Schema.String),
    icon: Schema.optional(Icon),
    commands: Schema.optional(Schema.Struct({ start: Schema.optional(Schema.String) })),
    time: Time,
    sandboxes: Schema.Array(Schema.String),
  }).annotate({ identifier: "Project" })

  export const UpdateInput = Schema.Struct({
    name: Schema.optional(Schema.String),
    icon: Schema.optional(Icon),
  }).annotate({ identifier: "ProjectUpdateInput" })

  const ProjectPath = Schema.Struct({
    projectID: Schema.String,
  })

  const Directory = Schema.Struct({
    directory: Schema.String,
    strategy: Schema.optional(Schema.String),
  }).annotate({ identifier: "ProjectDirectory" })

  const CopyCreateInput = Schema.Struct({
    strategy: Schema.Literal(ProjectCopy.Strategy),
    directory: Schema.String,
    name: Schema.optional(Schema.String),
  }).annotate({ identifier: "ProjectCopyCreateInput" })

  const CopyRemoveInput = Schema.Struct({
    directory: Schema.String,
    force: Schema.Boolean,
  }).annotate({ identifier: "ProjectCopyRemoveInput" })

  const Copy = Schema.Struct({ directory: Schema.String }).annotate({ identifier: "ProjectCopy" })
  const CopyRefresh = Schema.Struct({
    updated: Schema.Array(Schema.String),
    removed: Schema.Array(Schema.String),
  }).annotate({ identifier: "ProjectCopyRefresh" })

  export const Group = HttpApiGroup.make("project")
    .add(HttpApiEndpoint.get("list", "/", { success: Schema.Array(Info) }))
    .add(HttpApiEndpoint.get("current", "/current", { success: Info }))
    .add(
      HttpApiEndpoint.patch("update", "/:projectID", {
        params: ProjectPath,
        payload: UpdateInput,
        success: Info,
      }),
    )
    .add(
      HttpApiEndpoint.get("directoryList", "/:projectID/directory", {
        params: ProjectPath,
        success: Schema.Array(Directory),
      }).annotate(OpenApi.Identifier, "project.directory.list"),
    )
    .add(
      HttpApiEndpoint.post("copyCreate", "/:projectID/copy", {
        params: ProjectPath,
        payload: CopyCreateInput,
        success: Copy,
      }).annotate(OpenApi.Identifier, "project.copy.create"),
    )
    .add(
      HttpApiEndpoint.delete("copyRemove", "/:projectID/copy", {
        params: ProjectPath,
        payload: CopyRemoveInput,
        success: HttpApiSchema.NoContent,
      }).annotate(OpenApi.Identifier, "project.copy.remove"),
    )
    .add(
      HttpApiEndpoint.post("copyRefresh", "/:projectID/copy/refresh", {
        params: ProjectPath,
        success: CopyRefresh,
      }).annotate(OpenApi.Identifier, "project.copy.refresh"),
    )
    .prefix("/project")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    list: () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        return yield* project.list()
      }).pipe(Effect.orDie),
    current: () =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        return ctx.project
      }),
    update: ({ params, payload }: { params: { projectID: string }; payload: typeof UpdateInput.Type }) =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        return yield* project.update({
          projectID: params.projectID,
          name: payload.name,
          icon: payload.icon,
        })
      }).pipe(Effect.orDie),
    directoryList: ({ params }: { params: typeof ProjectPath.Type }) =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        return yield* project.directories(params.projectID)
      }).pipe(Effect.orDie),
    copyCreate: ({ params, payload }: { params: typeof ProjectPath.Type; payload: typeof CopyCreateInput.Type }) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const copies = yield* ProjectCopy.Service
        return yield* copies.create({
          projectID: params.projectID,
          strategy: payload.strategy,
          sourceDirectory: ctx.directory,
          directory: payload.directory,
          name: payload.name,
        })
      }).pipe(Effect.orDie),
    copyRemove: ({ params, payload }: { params: typeof ProjectPath.Type; payload: typeof CopyRemoveInput.Type }) =>
      Effect.gen(function* () {
        const copies = yield* ProjectCopy.Service
        yield* copies.remove({ projectID: params.projectID, directory: payload.directory, force: payload.force })
      }).pipe(Effect.orDie),
    copyRefresh: ({ params }: { params: typeof ProjectPath.Type }) =>
      Effect.gen(function* () {
        const copies = yield* ProjectCopy.Service
        return yield* copies.refresh({ projectID: params.projectID })
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "project", (builder) =>
    builder
      .handle("list", handlers.list)
      .handle("current", handlers.current)
      .handle("update", handlers.update)
      .handle("directoryList", handlers.directoryList)
      .handle("copyCreate", handlers.copyCreate)
      .handle("copyRemove", handlers.copyRemove)
      .handle("copyRefresh", handlers.copyRefresh),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(ProjectCopy.defaultLayer))
}
