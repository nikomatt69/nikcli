import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"
import { Workspace } from "../../workspace"
import { errors } from "../error"

const AdaptorInfo = z.object({
  type: z.string(),
  name: z.string(),
  description: z.string(),
  available: z.boolean().optional(),
})

export const WorkspaceRoutes = lazy(() =>
  new Hono()
    .get(
      "/adaptor",
      describeRoute({
        summary: "List workspace adaptors",
        description: "Get available workspace adaptor types for creating workspaces.",
        operationId: "experimental.workspace.adaptor.list",
        responses: {
          200: {
            description: "Available adaptors",
            content: {
              "application/json": {
                schema: resolver(z.array(AdaptorInfo)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json([
          { type: "worktree", name: "Worktree", description: "Create a local git worktree", available: true },
          { type: "container", name: "Container", description: "Docker/Podman container", available: true },
        ])
      },
    )
    .post(
      "/:id",
      describeRoute({
        summary: "Create workspace",
        description: "Create a workspace for the current project.",
        operationId: "experimental.workspace.create",
        responses: {
          200: {
            description: "Workspace created",
            content: {
              "application/json": {
                schema: resolver(Workspace.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          id: Workspace.Info.shape.id,
        }),
      ),
      validator(
        "json",
        z.object({
          branch: Workspace.Info.shape.branch,
          config: Workspace.Info.shape.config,
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const body = c.req.valid("json")
        const workspace = await Workspace.create({
          id,
          projectID: Instance.project.id,
          branch: body.branch,
          config: body.config,
        })
        return c.json(workspace)
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List workspaces",
        description: "List all workspaces.",
        operationId: "experimental.workspace.list",
        responses: {
          200: {
            description: "Workspaces",
            content: {
              "application/json": {
                schema: resolver(z.array(Workspace.Info)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Workspace.list(Instance.project))
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Remove workspace",
        description: "Remove an existing workspace.",
        operationId: "experimental.workspace.remove",
        responses: {
          200: {
            description: "Workspace removed",
            content: {
              "application/json": {
                schema: resolver(Workspace.Info.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          id: Workspace.Info.shape.id,
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        return c.json(await Workspace.remove(id))
      },
    ),
)
