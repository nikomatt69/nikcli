import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { zodToJsonSchema } from "zod-to-json-schema"
import { InstanceState } from "@/effect"
import { ManagedWorktree } from "@/worktree/managed"
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
  }).annotate({ identifier: "ToolListItem" })

  const McpResource = Schema.Struct({
    name: Schema.String,
    uri: Schema.String,
    description: Schema.optional(Schema.String),
    mimeType: Schema.optional(Schema.String),
    client: Schema.String,
  }).annotate({ identifier: "McpResource" })

  const ToolIDs = Schema.Array(Schema.String).annotate({
    identifier: "ToolIDs",
  })
  const ToolList = Schema.Array(ToolListItem).annotate({
    identifier: "ToolList",
  })
  const WorktreeList = Schema.Array(Schema.String).annotate({
    identifier: "WorktreeList",
  })
  const WorktreeInfo = Schema.Struct({
    name: Schema.String,
    branch: Schema.optional(Schema.String),
    directory: Schema.String,
  }).annotate({ identifier: "Worktree" })
  const WorktreeCreateInput = Schema.Struct({
    name: Schema.optional(Schema.String),
    branch: Schema.optional(Schema.String),
    branchPrefix: Schema.optional(Schema.String),
    baseBranch: Schema.optional(Schema.String),
    remote: Schema.optional(Schema.String),
    startCommand: Schema.optional(Schema.String),
  }).annotate({ identifier: "WorktreeCreateInput" })
  const WorktreeDirectoryInput = Schema.Struct({
    directory: Schema.String,
  }).annotate({ identifier: "WorktreeDirectoryInput" })
  const ResourceMap = Schema.Record(Schema.String, McpResource).annotate({
    identifier: "McpResourceMap",
  })

  // Managed worktree (CoW experimental engine) — mirrors the Hono
  // operation IDs in `routes/experimental.ts` so the SDK names stay
  // consistent regardless of which backend serves them.
  const ManagedWorktreeInfo = Schema.Struct({
    id: Schema.String,
    parentId: Schema.NullOr(Schema.String),
    name: Schema.String,
    branch: Schema.String,
    directory: Schema.String,
    createdAt: Schema.Number,
  }).annotate({ identifier: "ManagedWorktreeInfo" })
  const ManagedWorktreeList = Schema.Array(ManagedWorktreeInfo).annotate({
    identifier: "ManagedWorktreeList",
  })
  const ManagedWorktreeCreateInput = Schema.Struct({
    from: Schema.String,
    name: Schema.optional(Schema.String),
    into: Schema.optional(Schema.String),
  }).annotate({ identifier: "ManagedWorktreeCreateInput" })
  const ManagedWorktreeRemoveInput = Schema.Struct({
    at: Schema.String,
  }).annotate({ identifier: "ManagedWorktreeRemoveInput" })
  const ManagedWorktreeLinkInput = Schema.Struct({
    at: Schema.String,
    to: Schema.optional(Schema.String),
  }).annotate({ identifier: "ManagedWorktreeLinkInput" })
  const ManagedWorktreeTraversalInput = Schema.Struct({
    of: Schema.String,
  }).annotate({ identifier: "ManagedWorktreeTraversalInput" })

  export const Group = HttpApiGroup.make("experimental")
    .add(HttpApiEndpoint.get("toolIDs", "/tool/ids", { success: ToolIDs }))
    .add(
      HttpApiEndpoint.get("tools", "/tool", {
        query: ToolQuery,
        success: ToolList,
      }),
    )
    .add(
      HttpApiEndpoint.post("worktreeCreate", "/worktree", {
        payload: WorktreeCreateInput,
        success: WorktreeInfo,
      }),
    )
    .add(HttpApiEndpoint.get("worktree", "/worktree", { success: WorktreeList }))
    .add(
      HttpApiEndpoint.delete("worktreeRemove", "/worktree", {
        payload: WorktreeDirectoryInput,
        success: Schema.Boolean,
      }),
    )
    .add(
      HttpApiEndpoint.post("worktreeReset", "/worktree/reset", {
        payload: WorktreeDirectoryInput,
        success: Schema.Boolean,
      }),
    )
    .add(HttpApiEndpoint.get("resource", "/resource", { success: ResourceMap }))
    .add(
      HttpApiEndpoint.post("managedWorktreeCreate", "/managed-worktree", {
        payload: ManagedWorktreeCreateInput,
        success: ManagedWorktreeInfo,
      }),
    )
    .add(
      HttpApiEndpoint.delete("managedWorktreeRemove", "/managed-worktree", {
        payload: ManagedWorktreeRemoveInput,
        success: Schema.Null,
      }),
    )
    .add(
      HttpApiEndpoint.post("managedWorktreeLink", "/managed-worktree/link", {
        payload: ManagedWorktreeLinkInput,
        success: ManagedWorktreeInfo,
      }),
    )
    .add(
      HttpApiEndpoint.get("managedWorktreeChildren", "/managed-worktree/children", {
        query: ManagedWorktreeTraversalInput,
        success: ManagedWorktreeList,
      }),
    )
    .add(
      HttpApiEndpoint.get("managedWorktreeAncestors", "/managed-worktree/ancestors", {
        query: ManagedWorktreeTraversalInput,
        success: ManagedWorktreeList,
      }),
    )
    .add(
      HttpApiEndpoint.get("managedWorktreeList", "/managed-worktree", {
        success: ManagedWorktreeList,
      }),
    )
    .prefix("/experimental")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    toolIDs: () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        return yield* registry.ids()
      }).pipe(Effect.orDie),
    tools: ({ query }: { query: typeof ToolQuery.Type }) =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const tools = yield* registry.tools({
          providerID: query.provider,
          modelID: query.model,
        })
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
    managedWorktreeCreate: ({ payload }: { payload: typeof ManagedWorktreeCreateInput.Type }) =>
      Effect.gen(function* () {
        const service = yield* ManagedWorktree.Service
        return yield* service.create(payload as Schema.Schema.Type<typeof ManagedWorktree.CreateInputSchema>)
      }),
    managedWorktreeRemove: ({ payload }: { payload: typeof ManagedWorktreeRemoveInput.Type }) =>
      Effect.gen(function* () {
        const service = yield* ManagedWorktree.Service
        yield* service.remove(payload as Schema.Schema.Type<typeof ManagedWorktree.RemoveInputSchema>)
      }).pipe(Effect.as(null)),
    managedWorktreeLink: ({ payload }: { payload: typeof ManagedWorktreeLinkInput.Type }) =>
      Effect.gen(function* () {
        const service = yield* ManagedWorktree.Service
        return yield* service.link(payload as Schema.Schema.Type<typeof ManagedWorktree.LinkInputSchema>)
      }),
    managedWorktreeChildren: ({ query }: { query: typeof ManagedWorktreeTraversalInput.Type }) =>
      Effect.gen(function* () {
        const service = yield* ManagedWorktree.Service
        return yield* service.children(query as Schema.Schema.Type<typeof ManagedWorktree.ChildrenInputSchema>)
      }),
    managedWorktreeAncestors: ({ query }: { query: typeof ManagedWorktreeTraversalInput.Type }) =>
      Effect.gen(function* () {
        const service = yield* ManagedWorktree.Service
        return yield* service.ancestors(query as Schema.Schema.Type<typeof ManagedWorktree.AncestorsInputSchema>)
      }),
    managedWorktreeList: () =>
      Effect.gen(function* () {
        const service = yield* ManagedWorktree.Service
        return yield* service.list()
      }),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "experimental", (builder) =>
    builder
      .handle("toolIDs", () => handlers.toolIDs())
      .handle("tools", (request) => handlers.tools(request))
      .handle("worktreeCreate", (request) => handlers.worktreeCreate(request))
      .handle("worktree", () => handlers.worktree())
      .handle("worktreeRemove", (request) => handlers.worktreeRemove(request))
      .handle("worktreeReset", (request) => handlers.worktreeReset(request))
      .handle("resource", () => handlers.resource())
      .handle("managedWorktreeCreate", (request) => handlers.managedWorktreeCreate(request))
      .handle("managedWorktreeRemove", (request) => handlers.managedWorktreeRemove(request))
      .handle("managedWorktreeLink", (request) => handlers.managedWorktreeLink(request))
      .handle("managedWorktreeChildren", (request) => handlers.managedWorktreeChildren(request))
      .handle("managedWorktreeAncestors", (request) => handlers.managedWorktreeAncestors(request))
      .handle("managedWorktreeList", () => handlers.managedWorktreeList()),
  )

  export const DependenciesLive = Layer.mergeAll(
    ToolRegistry.defaultLayer,
    Project.defaultLayer,
    MCP.defaultLayer,
    Worktree.defaultLayer,
    ManagedWorktree.defaultLayer,
  ) as Layer.Layer<
    ToolRegistry.Service | Project.Service | MCP.Service | Worktree.Service | ManagedWorktree.Service,
    never,
    never
  >

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
