import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Identifier } from "../../id/id"
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
    .post(
      "/:id/restore",
      describeRoute({
        summary: "Restore workspace",
        description: "Ensure a workspace is connected and return enough state to restore the client UI.",
        operationId: "experimental.workspace.restore",
        responses: {
          200: {
            description: "Workspace restored",
            content: {
              "application/json": {
                schema: resolver(Workspace.Restore),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          id: Workspace.Info.shape.id,
        }),
      ),
      validator(
        "query",
        z.object({
          timeoutMs: z.coerce.number().int().positive().optional(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const query = c.req.valid("query")
        return c.json(
          await Workspace.restore({
            workspaceID: id,
            timeoutMs: query.timeoutMs ?? 30_000,
          }),
        )
      },
    )
    .post(
      "/:id/session/:sessionID/restore",
      describeRoute({
        summary: "Restore session into workspace",
        description: "Attach an existing session to a workspace and return restore state for the client.",
        operationId: "experimental.workspace.session.restore",
        responses: {
          200: {
            description: "Session restored",
            content: {
              "application/json": {
                schema: resolver(Workspace.SessionRestore),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          id: Workspace.Info.shape.id,
          sessionID: Identifier.schema("session"),
        }),
      ),
      validator(
        "query",
        z.object({
          timeoutMs: z.coerce.number().int().positive().optional(),
        }),
      ),
      async (c) => {
        const { id, sessionID } = c.req.valid("param")
        const query = c.req.valid("query")
        return c.json(
          await Workspace.sessionRestore({
            workspaceID: id,
            sessionID,
            timeoutMs: query.timeoutMs ?? 30_000,
          }),
        )
      },
    )
    .post(
      "/warp",
      describeRoute({
        summary: "Warp session into workspace",
        description: "Move a session to a target workspace, or detach it back to the local project.",
        operationId: "experimental.workspace.warp",
        responses: {
          204: {
            description: "Session warped",
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          id: z.union([Workspace.Info.shape.id, z.null()]),
          sessionID: Identifier.schema("session"),
          timeoutMs: z.number().int().positive().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await Workspace.sessionWarp({
          sessionID: body.sessionID,
          workspaceID: body.id,
          timeoutMs: body.timeoutMs ?? 30_000,
        })
        return c.body(null, 204)
      },
    )
    .post(
      "/session/:sessionID/warp",
      describeRoute({
        summary: "Warp session between workspaces",
        description:
          "Move a session to another workspace, or detach it back to the local project by passing workspaceID: null.",
        operationId: "experimental.workspace.session.warp",
        responses: {
          200: {
            description: "Session warped",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    sessionID: Identifier.schema("session"),
                    workspaceID: z.string().nullable(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: Identifier.schema("session") })),
      validator(
        "json",
        z.object({
          workspaceID: z.union([Workspace.Info.shape.id, z.null()]),
          timeoutMs: z.number().int().positive().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(
          await Workspace.sessionWarp({
            sessionID,
            workspaceID: body.workspaceID,
            timeoutMs: body.timeoutMs ?? 30_000,
          }),
        )
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
