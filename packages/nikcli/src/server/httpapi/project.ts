import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
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
  }).annotate({ identifier: "Project" })

  export const UpdateInput = Schema.Struct({
    name: Schema.optional(Schema.String),
    icon: Schema.optional(Icon),
  }).annotate({ identifier: "ProjectUpdateInput" })

  const ProjectPath = Schema.Struct({
    projectID: Schema.String,
  })

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
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "project", (builder) =>
    builder.handle("list", handlers.list).handle("current", handlers.current).handle("update", handlers.update),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(Project.defaultLayer))
}
