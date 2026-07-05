import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Identifier } from "../../id/id"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"
import { Workspace } from "../../workspace"
import { ConnectionStatusInfo } from "../../workspace/connection"
import { listAdaptors } from "../../workspace/adaptors"
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
        return c.json(
          listAdaptors().map(({ type, adaptor }) => ({
            type,
            name: adaptor.name,
            description: adaptor.description,
            available: true,
          })),
        )
      },
    )
    // NOTE: `/warp` must be registered before the dynamic `/:id` create route,
    // otherwise `POST /warp` is matched as create-with-id="warp" and 400s.
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
          // `.nullable()` short-circuits on null; a raw z.union([wrkString, null])
          // lets the custom id schema reject null with a misleading "must start
          // with wrk" 400, which broke detach-to-local warps.
          id: Workspace.Info.shape.id.nullable(),
          sessionID: Identifier.schema("session"),
          copyChanges: z.boolean().optional(),
          timeoutMs: z.number().int().positive().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await Workspace.sessionWarp({
          sessionID: body.sessionID,
          workspaceID: body.id,
          copyChanges: body.copyChanges,
          timeoutMs: body.timeoutMs ?? 30_000,
        })
        return c.body(null, 204)
      },
    )
    .post(
      "/sync-list",
      describeRoute({
        summary: "Sync workspace list",
        description: "Register missing workspaces returned by workspace adaptors.",
        operationId: "experimental.workspace.syncList",
        responses: {
          204: {
            description: "Workspace list synced",
          },
        },
      }),
      async (c) => {
        await Workspace.syncList(Instance.project)
        return c.body(null, 204)
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Workspace status",
        description: "Get connection status for workspaces in the current project.",
        operationId: "experimental.workspace.status",
        responses: {
          200: {
            description: "Workspace connection statuses",
            content: {
              "application/json": {
                schema: resolver(z.array(ConnectionStatusInfo)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Workspace.statuses(Instance.project))
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
      "/:id/events",
      describeRoute({
        summary: "Workspace event journal",
        description:
          "Sequenced restore events for a workspace. Pass `from` (last seen sequence number) to catch up incrementally after a disconnect.",
        operationId: "experimental.workspace.events",
        responses: {
          200: {
            description: "Journaled workspace events",
            content: {
              "application/json": {
                schema: resolver(z.array(Workspace.JournalEvent)),
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
          from: z.coerce.number().int().nonnegative().optional(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const query = c.req.valid("query")
        return c.json(await Workspace.events({ workspaceID: id, from: query.from }))
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
          workspaceID: Workspace.Info.shape.id.nullable(),
          copyChanges: z.boolean().optional(),
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
            copyChanges: body.copyChanges,
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
