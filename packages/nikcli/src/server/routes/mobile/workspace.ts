import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Worktree } from "@/worktree"
import { errors } from "../../error"
import { Effect } from "effect"
import { runWorktree, runProject } from "./helpers"

export const WorkspaceRoutes = () =>
  new Hono()
    .post(
      "/worktree",
      describeRoute({
        summary: "Create mobile worktree",
        description: "Create a git worktree for sandboxed mobile work.",
        operationId: "mobile.worktree.create",
        responses: {
          200: {
            description: "Worktree created",
            content: { "application/json": { schema: resolver(Worktree.Info) } },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.CreateInput.optional()),
      async (c) => {
        const worktree = await runWorktree(
          Effect.gen(function* () {
            const service = yield* Worktree.Service
            return yield* service.create(c.req.valid("json") ?? undefined)
          }),
        )
        return c.json(worktree)
      },
    )
    .post(
      "/worktree/reset",
      describeRoute({
        summary: "Reset mobile worktree",
        description: "Reset a worktree back to the default branch state.",
        operationId: "mobile.worktree.reset",
        responses: {
          200: {
            description: "Worktree reset",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("json", Worktree.ResetInput),
      async (c) => {
        await runWorktree(
          Effect.gen(function* () {
            const service = yield* Worktree.Service
            yield* service.reset(c.req.valid("json"))
          }),
        )
        return c.json({ success: true as const })
      },
    )
    .delete(
      "/worktree",
      describeRoute({
        summary: "Remove mobile worktree",
        description: "Remove an existing worktree sandbox.",
        operationId: "mobile.worktree.remove",
        responses: {
          200: {
            description: "Worktree removed",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("json", Worktree.RemoveInput),
      async (c) => {
        const input = c.req.valid("json")
        await runWorktree(
          Effect.gen(function* () {
            const service = yield* Worktree.Service
            yield* service.remove(input)
          }),
        )
        await runProject(
          Effect.gen(function* () {
            const project = yield* Project.Service
            yield* project.removeSandbox(Instance.project.id, input.directory)
          }),
        ).catch(() => undefined)
        return c.json({ success: true as const })
      },
    )
