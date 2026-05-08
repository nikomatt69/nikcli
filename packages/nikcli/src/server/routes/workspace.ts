import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Identifier } from "../../id/id"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"
import { Workspace } from "../../workspace"
import { ConfigSchema as WorkspaceConfigSchema } from "../../workspace/config"
import { errors } from "../error"
import { Schema } from "effect"
import { zod, zodObject, zodObjectMode } from "@/util/effect-zod"

const strip = zodObjectMode("strip")
const AdaptorInfoSchema = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  description: Schema.String,
  available: Schema.optional(Schema.Boolean),
}).annotations({ identifier: "WorkspaceAdaptorInfo", ...strip })
const WorkspaceIDParam = zodObject(
  Schema.Struct({
    id: Identifier.schemaEffect("workspace"),
  }).annotations(strip),
)
const RestoreParam = zodObject(
  Schema.Struct({
    id: Identifier.schemaEffect("workspace"),
    sessionID: Identifier.schemaEffect("session"),
  }).annotations(strip),
)
const TimeoutQuery = zodObject(
  Schema.Struct({
    timeoutMs: Schema.optional(Schema.NumberFromString.pipe(Schema.int(), Schema.greaterThan(0))),
  }).annotations(strip),
)
const CreateWorkspaceInput = zodObject(
  Schema.Struct({
    branch: Schema.NullOr(Schema.String),
    config: WorkspaceConfigSchema,
  }).annotations(strip),
)

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
                schema: resolver(zod(Schema.Array(AdaptorInfoSchema))),
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
        WorkspaceIDParam,
      ),
      validator(
        "json",
        CreateWorkspaceInput,
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
        WorkspaceIDParam,
      ),
      validator(
        "query",
        TimeoutQuery,
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
        RestoreParam,
      ),
      validator(
        "query",
        TimeoutQuery,
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
                schema: resolver(Workspace.Info.array()),
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
        WorkspaceIDParam,
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        return c.json(await Workspace.remove(id))
      },
    ),
)
