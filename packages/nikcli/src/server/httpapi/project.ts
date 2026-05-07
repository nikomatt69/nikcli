import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { InstanceState } from "@/effect"
import { Project } from "@/project/project"

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
    vcs: Schema.optional(Schema.Literal("git")),
    name: Schema.optional(Schema.String),
    icon: Schema.optional(Icon),
    time: Time,
    sandboxes: Schema.Array(Schema.String),
  }).annotations({ identifier: "Project" })

  export const UpdateInput = Schema.Struct({
    name: Schema.optional(Schema.String),
    icon: Schema.optional(Icon),
  }).annotations({ identifier: "ProjectUpdateInput" })

  const ProjectPath = Schema.Struct({
    projectID: Schema.String,
  })

  export const Group = HttpApiGroup.make("project")
    .add(HttpApiEndpoint.get("list", "/").addSuccess(Schema.Array(Info)))
    .add(HttpApiEndpoint.get("current", "/current").addSuccess(Info))
    .add(
      HttpApiEndpoint.patch("update", "/:projectID")
        .setPath(ProjectPath)
        .setPayload(UpdateInput)
        .addSuccess(Info),
    )
    .prefix("/project")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.api(Api)

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
    update: ({ path, payload }: { path: { projectID: string }; payload: typeof UpdateInput.Type }) =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        return yield* project.update({
          projectID: path.projectID,
          name: payload.name,
          icon: payload.icon,
        })
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "project", (builder) =>
    builder
      .handle("list", handlers.list)
      .handle("current", handlers.current)
      .handle("update", handlers.update),
  )

  export const layer = ApiLive.pipe(
    Layer.provide(HandlersLive),
    Layer.provide(Project.defaultLayer),
  )
}
