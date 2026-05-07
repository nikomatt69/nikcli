import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { zodToJsonSchema } from "zod-to-json-schema"
import { InstanceState } from "@/effect"
import { MCP } from "@/mcp"
import { Project } from "@/project/project"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"

export namespace ExperimentalHttpApi {
  const ToolQuery = Schema.Struct({
    provider: Schema.String,
    model: Schema.String,
  })

  const ToolListItem = Schema.Struct({
    id: Schema.String,
    description: Schema.String,
    parameters: Schema.Unknown,
  }).annotations({ identifier: "ToolListItem" })

  const McpResource = Schema.Struct({
    name: Schema.String,
    uri: Schema.String,
    description: Schema.optional(Schema.String),
    mimeType: Schema.optional(Schema.String),
    client: Schema.String,
  }).annotations({ identifier: "McpResource" })

  const ToolIDs = Schema.Array(Schema.String).annotations({ identifier: "ToolIDs" })
  const ToolList = Schema.Array(ToolListItem).annotations({ identifier: "ToolList" })
  const WorktreeList = Schema.Array(Schema.String).annotations({ identifier: "WorktreeList" })
  const WorktreeInfo = Schema.Struct({
    name: Schema.String,
    branch: Schema.String,
    directory: Schema.String,
  }).annotations({ identifier: "Worktree" })
  const WorktreeCreateInput = Schema.Struct({
    name: Schema.optional(Schema.String),
    branch: Schema.optional(Schema.String),
    branchPrefix: Schema.optional(Schema.String),
    baseBranch: Schema.optional(Schema.String),
    remote: Schema.optional(Schema.String),
    startCommand: Schema.optional(Schema.String),
  }).annotations({ identifier: "WorktreeCreateInput" })
  const WorktreeDirectoryInput = Schema.Struct({
    directory: Schema.String,
  }).annotations({ identifier: "WorktreeDirectoryInput" })
  const ResourceMap = Schema.Record({ key: Schema.String, value: McpResource }).annotations({
    identifier: "McpResourceMap",
  })

  export const Group = HttpApiGroup.make("experimental")
    .add(HttpApiEndpoint.get("toolIDs", "/tool/ids").addSuccess(ToolIDs))
    .add(HttpApiEndpoint.get("tools", "/tool").setUrlParams(ToolQuery).addSuccess(ToolList))
    .add(HttpApiEndpoint.post("worktreeCreate", "/worktree").setPayload(WorktreeCreateInput).addSuccess(WorktreeInfo))
    .add(HttpApiEndpoint.get("worktree", "/worktree").addSuccess(WorktreeList))
    .add(HttpApiEndpoint.del("worktreeRemove", "/worktree").setPayload(WorktreeDirectoryInput).addSuccess(Schema.Boolean))
    .add(
      HttpApiEndpoint.post("worktreeReset", "/worktree/reset")
        .setPayload(WorktreeDirectoryInput)
        .addSuccess(Schema.Boolean),
    )
    .add(HttpApiEndpoint.get("resource", "/resource").addSuccess(ResourceMap))
    .prefix("/experimental")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.api(Api)

  export const handlers = {
    toolIDs: () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        return yield* registry.ids()
      }).pipe(Effect.orDie),
    tools: ({ urlParams }: { urlParams: typeof ToolQuery.Type }) =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const tools = yield* registry.tools({ providerID: urlParams.provider, modelID: urlParams.model })
        return tools.map((tool) => ({
          id: tool.id,
          description: tool.description,
          parameters: (tool.parameters as any)?._def ? zodToJsonSchema(tool.parameters as any) : tool.parameters,
        }))
      }).pipe(Effect.orDie),
    worktree: () =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const project = yield* Project.Service
        return yield* project.sandboxes(ctx.project.id)
      }).pipe(Effect.orDie),
    worktreeCreate: ({ payload }: { payload: typeof WorktreeCreateInput.Type }) =>
      Effect.gen(function* () {
        const worktree = yield* Worktree.Service
        return yield* worktree.create(payload as Worktree.CreateInput)
      }).pipe(Effect.orDie),
    worktreeRemove: ({ payload }: { payload: typeof WorktreeDirectoryInput.Type }) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const worktree = yield* Worktree.Service
        yield* worktree.remove(payload)
        const project = yield* Project.Service
        yield* project.removeSandbox(ctx.project.id, payload.directory)
        return true
      }).pipe(Effect.orDie),
    worktreeReset: ({ payload }: { payload: typeof WorktreeDirectoryInput.Type }) =>
      Effect.gen(function* () {
        const worktree = yield* Worktree.Service
        yield* worktree.reset(payload)
        return true
      }).pipe(Effect.orDie),
    resource: () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        return yield* mcp.resources()
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "experimental", (builder) =>
    builder
      .handle("toolIDs", () => handlers.toolIDs())
      .handle("tools", (request) => handlers.tools(request))
      .handle("worktreeCreate", (request) => handlers.worktreeCreate(request))
      .handle("worktree", () => handlers.worktree())
      .handle("worktreeRemove", (request) => handlers.worktreeRemove(request))
      .handle("worktreeReset", (request) => handlers.worktreeReset(request))
      .handle("resource", () => handlers.resource()),
  )

  export const DependenciesLive = Layer.mergeAll(
    ToolRegistry.defaultLayer,
    Project.defaultLayer,
    MCP.defaultLayer,
    Worktree.defaultLayer,
  ) as Layer.Layer<ToolRegistry.Service | Project.Service | MCP.Service | Worktree.Service, never, never>

  export const layer = ApiLive.pipe(
    Layer.provide(HandlersLive),
    Layer.provide(DependenciesLive),
  )
}
