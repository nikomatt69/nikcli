import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { ToolRegistry } from "../../tool/registry"
import { Worktree } from "../../worktree"
import { ManagedWorktree } from "../../worktree/managed"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { MCP } from "../../mcp"
import { zodToJsonSchema } from "zod-to-json-schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { WorkspaceRoutes } from "./workspace"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

function runToolRegistry<A, E>(effect: Effect.Effect<A, E, ToolRegistry.Service>) {
  return runPromiseWithLayer(ToolRegistry.defaultLayer, withCurrentInstance(effect))
}

function runWorktree<A, E>(effect: Effect.Effect<A, E, Worktree.Service>) {
  return runPromiseWithLayer(Worktree.defaultLayer, withCurrentInstance(effect))
}

function runManagedWorktree<A, E>(effect: Effect.Effect<A, E, ManagedWorktree.Service>) {
  return runPromiseWithLayer(ManagedWorktree.defaultLayer, withCurrentInstance(effect))
}

function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runPromiseWithLayer(Project.defaultLayer, effect)
}

function runMCP<A, E>(effect: Effect.Effect<A, E, MCP.Service>) {
  return runPromiseWithLayer(MCP.defaultLayer, withCurrentInstance(effect))
}

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .get(
      "/tool/ids",
      describeRoute({
        summary: "List tool IDs",
        description:
          "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
        operationId: "tool.ids",
        responses: {
          200: {
            description: "Tool IDs",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string()).meta({ ref: "ToolIDs" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const ids = await runToolRegistry(
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            return yield* registry.ids()
          }),
        )
        return c.json(ids)
      },
    )
    .get(
      "/tool",
      describeRoute({
        summary: "List tools",
        description:
          "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
        operationId: "tool.list",
        responses: {
          200: {
            description: "Tools",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .array(
                      z
                        .object({
                          id: z.string(),
                          description: z.string(),
                          parameters: z.any(),
                        })
                        .meta({ ref: "ToolListItem" }),
                    )
                    .meta({ ref: "ToolList" }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          provider: z.string(),
          model: z.string(),
        }),
      ),
      async (c) => {
        const { provider, model } = c.req.valid("query")
        const tools = await runToolRegistry(
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            return yield* registry.tools({
              providerID: provider,
              modelID: model,
            })
          }),
        )
        return c.json(
          tools.map((t) => ({
            id: t.id,
            description: t.description,
            // Handle both Zod schemas and plain JSON schemas
            parameters: (t.parameters as any)?._def ? zodToJsonSchema(t.parameters as any) : t.parameters,
          })),
        )
      },
    )
    .post(
      "/worktree",
      describeRoute({
        summary: "Create worktree",
        description: "Create a new git worktree for the current project.",
        operationId: "worktree.create",
        responses: {
          200: {
            description: "Worktree created",
            content: {
              "application/json": {
                schema: resolver(Worktree.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.CreateInput.optional()),
      async (c) => {
        const body = c.req.valid("json")
        const worktree = await runWorktree(
          Effect.gen(function* () {
            const service = yield* Worktree.Service
            return yield* service.create(body)
          }),
        )
        return c.json(worktree)
      },
    )
    .route("/workspace", WorkspaceRoutes())
    .get(
      "/worktree",
      describeRoute({
        summary: "List worktrees",
        description: "List all sandbox worktrees for the current project.",
        operationId: "worktree.list",
        responses: {
          200: {
            description: "List of worktree directories",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) => {
        const sandboxes = await runProject(
          Effect.gen(function* () {
            const project = yield* Project.Service
            return yield* project.sandboxes(Instance.project.id)
          }),
        )
        return c.json(sandboxes)
      },
    )
    .delete(
      "/worktree",
      describeRoute({
        summary: "Remove worktree",
        description: "Remove a git worktree and delete its branch.",
        operationId: "worktree.remove",
        responses: {
          200: {
            description: "Worktree removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.RemoveInput),
      async (c) => {
        const body = c.req.valid("json")
        await runWorktree(
          Effect.gen(function* () {
            const service = yield* Worktree.Service
            yield* service.remove(body)
          }),
        )
        await runProject(
          Effect.gen(function* () {
            const project = yield* Project.Service
            yield* project.removeSandbox(Instance.project.id, body.directory)
          }),
        )
        return c.json(true)
      },
    )
    .post(
      "/worktree/reset",
      describeRoute({
        summary: "Reset worktree",
        description: "Reset a worktree branch to the primary default branch.",
        operationId: "worktree.reset",
        responses: {
          200: {
            description: "Worktree reset",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.ResetInput),
      async (c) => {
        const body = c.req.valid("json")
        await runWorktree(
          Effect.gen(function* () {
            const service = yield* Worktree.Service
            yield* service.reset(body)
          }),
        )
        return c.json(true)
      },
    )
    .get(
      "/resource",
      describeRoute({
        summary: "Get MCP resources",
        description: "Get all available MCP resources from connected servers. Optionally filter by name.",
        operationId: "experimental.resource.list",
        responses: {
          200: {
            description: "MCP resources",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Resource)),
              },
            },
          },
        },
      }),
      async (c) => {
        const resources = await runMCP(
          Effect.gen(function* () {
            const mcp = yield* MCP.Service
            return yield* mcp.resources()
          }),
        )
        return c.json(resources)
      },
    )
    // Managed worktree routes (based on opencode PR #30117)
    .post(
      "/managed-worktree",
      describeRoute({
        summary: "Create managed worktree",
        description: "Clone a workspace with copy-on-write support.",
        operationId: "managed-worktree.create",
        responses: {
          200: {
            description: "Managed worktree created",
            content: {
              "application/json": {
                schema: resolver(ManagedWorktree.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ManagedWorktree.CreateInput.optional()),
      async (c) => {
        const body = c.req.valid("json")
        const worktree = await runManagedWorktree(
          Effect.gen(function* () {
            const service = yield* ManagedWorktree.Service
            return yield* service.create(body)
          }),
        )
        return c.json(worktree)
      },
    )
    .delete(
      "/managed-worktree",
      describeRoute({
        summary: "Remove managed worktree",
        description: "Remove a managed worktree and its descendant subtree.",
        operationId: "managed-worktree.remove",
        responses: {
          200: {
            description: "Managed worktree removed",
            content: {
              "application/json": {
                schema: resolver(z.null()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ManagedWorktree.RemoveInput),
      async (c) => {
        const body = c.req.valid("json")
        await runManagedWorktree(
          Effect.gen(function* () {
            const service = yield* ManagedWorktree.Service
            yield* service.remove(body)
          }),
        )
        return c.json(null)
      },
    )
    .post(
      "/managed-worktree/link",
      describeRoute({
        summary: "Link managed worktree",
        description: "Reconnect a moved managed worktree to its registry record.",
        operationId: "managed-worktree.link",
        responses: {
          200: {
            description: "Managed worktree linked",
            content: {
              "application/json": {
                schema: resolver(ManagedWorktree.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ManagedWorktree.LinkInput),
      async (c) => {
        const body = c.req.valid("json")
        const result = await runManagedWorktree(
          Effect.gen(function* () {
            const service = yield* ManagedWorktree.Service
            return yield* service.link(body)
          }),
        )
        return c.json(result)
      },
    )
    .get(
      "/managed-worktree/children",
      describeRoute({
        summary: "List managed worktree children",
        description: "Get direct managed children of a worktree.",
        operationId: "managed-worktree.children",
        responses: {
          200: {
            description: "Managed worktree children",
            content: {
              "application/json": {
                schema: resolver(z.array(ManagedWorktree.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("query", ManagedWorktree.ChildrenInput),
      async (c) => {
        const body = c.req.valid("query")
        const children = await runManagedWorktree(
          Effect.gen(function* () {
            const service = yield* ManagedWorktree.Service
            return yield* service.children(body)
          }),
        )
        return c.json(children)
      },
    )
    .get(
      "/managed-worktree/ancestors",
      describeRoute({
        summary: "List managed worktree ancestors",
        description: "Get the managed ancestry of a worktree.",
        operationId: "managed-worktree.ancestors",
        responses: {
          200: {
            description: "Managed worktree ancestors",
            content: {
              "application/json": {
                schema: resolver(z.array(ManagedWorktree.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("query", ManagedWorktree.AncestorsInput),
      async (c) => {
        const body = c.req.valid("query")
        const ancestors = await runManagedWorktree(
          Effect.gen(function* () {
            const service = yield* ManagedWorktree.Service
            return yield* service.ancestors(body)
          }),
        )
        return c.json(ancestors)
      },
    )
    .get(
      "/managed-worktree",
      describeRoute({
        summary: "List all managed worktrees",
        description: "Get all registered managed worktrees.",
        operationId: "managed-worktree.list",
        responses: {
          200: {
            description: "Managed worktrees",
            content: {
              "application/json": {
                schema: resolver(z.array(ManagedWorktree.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const worktrees = await runManagedWorktree(
          Effect.gen(function* () {
            const service = yield* ManagedWorktree.Service
            return yield* service.list()
          }),
        )
        return c.json(worktrees)
      },
    ),
)
