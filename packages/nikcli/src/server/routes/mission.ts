/**
 * Missions — HTTP routes for the headless orchestrator.
 *
 * Mirrors `routes/loop.ts`: the TUI plugin remains the primary user-facing
 * surface, but the same data shape is exposed here so:
 *   - other clients (mobile, web) can manage missions;
 *   - the orchestrator runs with the TUI closed.
 *
 * All write endpoints mutate persisted state and emit `MissionEvent.*` bus
 * events so live TUI subscribers stay in sync.
 */

import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Bus } from "../../bus"
import { generateFromDescription } from "../../mission/generate"
import * as Engine from "../../mission/orchestrator"
import * as Manager from "../../mission/manager"
import {
  MISSION_TEMPLATES,
  MissionDefinitionSchema,
  MilestoneStatusSchema,
  ExecStatusSchema,
  type MissionDefinition,
  generateID,
  validateDefinition,
  type MissionModels,
} from "../../mission/schema"
import { Log } from "../../util/log"
import { errors } from "../error"

const log = Log.create({ service: "mission.routes" })

const MissionRuntimeSchema = z
  .object({
    missionID: z.string(),
    status: z.enum(["idle", "running", "paused", "error", "cancelling"]),
    sessionID: z.string().optional(),
    currentMilestoneID: z.string().optional(),
    currentFeatureID: z.string().optional(),
    doneFeatures: z.number(),
    totalFeatures: z.number(),
    lastError: z.string().optional(),
    lastRunAt: z.number().optional(),
  })
  .meta({ ref: "MissionRuntime" })

const MissionDefinitionDTOSchema = MissionDefinitionSchema.meta({
  ref: "MissionDefinition",
})

const MissionExecDTOSchema = z
  .object({
    id: z.string(),
    missionID: z.string(),
    kind: z.enum(["feature", "validation"]),
    targetID: z.string(),
    targetName: z.string(),
    startedAt: z.number(),
    endedAt: z.number().optional(),
    status: ExecStatusSchema,
    ok: z.boolean(),
    error: z.string().optional(),
    sessionID: z.string().optional(),
  })
  .meta({ ref: "MissionExec" })

const MissionTemplateDTOSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    brief: z.string(),
  })
  .meta({ ref: "MissionTemplate" })

const CreateInput = MissionDefinitionSchema.omit({
  id: true,
  createdAt: true,
  status: true,
})
const UpdateInput = MissionDefinitionSchema

export function MissionRoutes() {
  return new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List missions",
        description: "List all missions defined for the current project, with live runtime status.",
        operationId: "mission.list",
        responses: {
          200: {
            description: "All missions with runtime status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    missions: MissionDefinitionDTOSchema.array(),
                    runtimes: z.array(MissionRuntimeSchema),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const missions = await Manager.list()
        const runtimes = missions.map((m) => ({
          missionID: m.id,
          ...Engine.getRuntime(m.id),
        }))
        return c.json({ missions, runtimes })
      },
    )
    .get(
      "/templates",
      describeRoute({
        summary: "List mission templates",
        description: "Built-in starter briefs the user can instantiate from the wizard.",
        operationId: "mission.templates",
        responses: {
          200: {
            description: "Templates",
            content: {
              "application/json": {
                schema: resolver(z.object({ templates: z.array(MissionTemplateDTOSchema) })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ templates: MISSION_TEMPLATES })
      },
    )
    .post(
      "/generate",
      describeRoute({
        summary: "Generate a mission plan from a description",
        description:
          "Send a natural-language description to an AI and parse the response back into a fully-formed mission definition (brief + milestones + features). The response is a draft — the user still confirms before persistence.",
        operationId: "mission.generate",
        responses: {
          200: {
            description: "Generated mission definition",
            content: {
              "application/json": {
                schema: resolver(MissionDefinitionDTOSchema),
              },
            },
          },
          ...errors(400, 404, 500),
        },
      }),
      validator(
        "json",
        z.object({
          description: z.string().min(1).meta({
            description: "Natural-language description of the mission",
          }),
          model: z
            .string()
            .regex(/^[^/]+\/[^/]+$/)
            .optional()
            .meta({
              description: "Optional model override (providerID/modelID)",
            }),
          agent: z.string().optional().meta({
            description: "Default agent if the model doesn't pick one",
          }),
        }),
      ),
      async (c) => {
        const { description, model, agent } = c.req.valid("json")
        const generated = await generateFromDescription(description, {
          model,
          agent,
        })
        return c.json(generated)
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get a mission",
        description: "Fetch a single mission definition by id, including its live runtime status.",
        operationId: "mission.get",
        responses: {
          200: {
            description: "The mission",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    mission: MissionDefinitionDTOSchema,
                    runtime: MissionRuntimeSchema,
                  }),
                ),
              },
            },
          },
          404: { description: "Mission not found" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const mission = await Manager.get(id)
        if (!mission)
          return c.json(
            {
              name: "NotFound",
              data: { message: `Mission "${id}" not found` },
            },
            404,
          )
        return c.json({
          mission,
          runtime: { missionID: id, ...Engine.getRuntime(id) },
        })
      },
    )
    .put(
      "/",
      describeRoute({
        summary: "Create or update a mission",
        description: "Persist a mission definition. Generates the id, createdAt, and default status for new missions.",
        operationId: "mission.upsert",
        responses: {
          200: {
            description: "Persisted mission",
            content: {
              "application/json": {
                schema: resolver(MissionDefinitionDTOSchema),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", CreateInput),
      async (c) => {
        const body = c.req.valid("json")
        const id = generateID()
        const def: MissionDefinition = {
          ...body,
          id,
          status: "ready",
          createdAt: Date.now(),
          models: body.models ?? {},
        }
        const err = validateDefinition(def)
        if (err) return c.json({ name: "ValidationError", data: { message: err } }, 400)
        const saved = await Manager.upsert(def)
        void Bus.publish(Engine.MissionEvent.Upserted, { missionID: saved.id })
        return c.json(saved)
      },
    )
    .post(
      "/:id",
      describeRoute({
        summary: "Update a mission",
        description:
          "Replace a mission definition. Status field is preserved unless the body changes it explicitly (so updates from the wizard don't accidentally restart orchestration).",
        operationId: "mission.update",
        responses: {
          200: {
            description: "Updated mission",
            content: {
              "application/json": {
                schema: resolver(MissionDefinitionDTOSchema),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator("json", UpdateInput),
      async (c) => {
        const { id } = c.req.valid("param")
        const body = c.req.valid("json")
        if (body.id !== id) {
          return c.json(
            {
              name: "ValidationError",
              data: { message: "Path id and body id do not match" },
            },
            400,
          )
        }
        const err = validateDefinition(body)
        if (err) return c.json({ name: "ValidationError", data: { message: err } }, 400)
        const existing = await Manager.get(id)
        if (!existing)
          return c.json(
            {
              name: "NotFound",
              data: { message: `Mission "${id}" not found` },
            },
            404,
          )
        const saved = await Manager.upsert(body)
        void Bus.publish(Engine.MissionEvent.Upserted, { missionID: saved.id })
        return c.json(saved)
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete a mission",
        description: "Remove a mission and its execution history. Cancels any in-flight orchestration first.",
        operationId: "mission.delete",
        responses: {
          200: { description: "Deleted" },
          404: { description: "Mission not found" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const def = await Manager.get(id)
        if (!def)
          return c.json(
            {
              name: "NotFound",
              data: { message: `Mission "${id}" not found` },
            },
            404,
          )
        // Cancel any in-flight orchestration *before* removing the definition
        // so no orphan `MissionExec` is written for a mission the user just
        // deleted.
        await Engine.cancel(id).catch((error) => {
          log.warn("cancel on delete failed", { id, error })
        })
        const removed = await Manager.remove(id)
        if (!removed)
          return c.json(
            {
              name: "NotFound",
              data: { message: `Mission "${id}" not found` },
            },
            404,
          )
        void Bus.publish(Engine.MissionEvent.Removed, { missionID: id })
        return c.json(true)
      },
    )
    .post(
      "/:id/start",
      describeRoute({
        summary: "Start (or resume) orchestration of a mission",
        description:
          "Drive the mission forward: pick the current milestone, run its ready features, validate, then advance. Resumes a paused or frozen mission; returns immediately if already in flight.",
        operationId: "mission.start",
        responses: {
          200: { description: "Orchestration started" },
          404: { description: "Mission not found" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const def = await Manager.get(id)
        if (!def)
          return c.json(
            {
              name: "NotFound",
              data: { message: `Mission "${id}" not found` },
            },
            404,
          )
        void Engine.start(id)
        return c.json(true)
      },
    )
    .post(
      "/:id/pause",
      describeRoute({
        summary: "Pause a mission",
        description: "Persist the paused flag and abort the current worker. Resume with /:id/start.",
        operationId: "mission.pause",
        responses: {
          200: { description: "Paused" },
          404: { description: "Mission not found" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const def = await Manager.get(id)
        if (!def)
          return c.json(
            {
              name: "NotFound",
              data: { message: `Mission "${id}" not found` },
            },
            404,
          )
        await Engine.pause(id)
        return c.json(true)
      },
    )
    .post(
      "/:id/cancel",
      describeRoute({
        summary: "Cancel and freeze a mission",
        description:
          "Freeze the mission for reassessment. The orchestrator aborts, the persisted status becomes 'frozen', and the user can edit the plan before resuming.",
        operationId: "mission.cancel",
        responses: {
          200: { description: "Cancelled" },
          404: { description: "Mission not found" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const def = await Manager.get(id)
        if (!def)
          return c.json(
            {
              name: "NotFound",
              data: { message: `Mission "${id}" not found` },
            },
            404,
          )
        await Engine.cancel(id)
        return c.json(true)
      },
    )
    .post(
      "/:id/feature/:featureID",
      describeRoute({
        summary: "Mutate a single feature (skip / mark-done / reset / add deps)",
        description:
          "Power-user lever: re-plan mid-flight by skipping a stuck feature, marking it done to advance, or resetting it to retry. Status transitions are coerced to the legal subset.",
        operationId: "mission.feature.mutate",
        responses: {
          200: { description: "Updated mission" },
          400: { description: "Invalid mutation" },
          404: { description: "Mission or feature not found" },
        },
      }),
      validator("param", z.object({ id: z.string(), featureID: z.string() })),
      validator(
        "json",
        z.object({
          status: z.enum(["pending", "running", "done", "blocked", "skipped", "error"]).optional(),
          error: z.string().optional(),
          appendDependsOn: z.array(z.string()).optional(),
        }),
      ),
      async (c) => {
        const { id, featureID } = c.req.valid("param")
        const body = c.req.valid("json")
        const def = await Manager.get(id)
        if (!def)
          return c.json(
            {
              name: "NotFound",
              data: { message: `Mission "${id}" not found` },
            },
            404,
          )
        let found = false
        const milestones = def.milestones.map((m) => ({
          ...m,
          features: m.features.map((f) => {
            if (f.id !== featureID) return f
            found = true
            const next: typeof f = { ...f }
            if (body.status !== undefined) next.status = body.status
            if (body.status === "done") next.error = undefined
            if (body.error !== undefined) next.error = body.error
            if (body.appendDependsOn && body.appendDependsOn.length > 0) {
              const known = new Set(m.features.map((ff) => ff.id))
              const extras = body.appendDependsOn.filter(
                (d) => known.has(d) && d !== next.id && !next.dependsOn.includes(d),
              )
              next.dependsOn = [...next.dependsOn, ...extras]
            }
            return next
          }),
        }))
        if (!found)
          return c.json(
            {
              name: "NotFound",
              data: { message: `Feature "${featureID}" not found` },
            },
            404,
          )
        const updated: MissionDefinition = { ...def, milestones }
        const err = validateDefinition(updated)
        if (err) return c.json({ name: "ValidationError", data: { message: err } }, 400)
        const saved = await Manager.upsert(updated)
        void Bus.publish(Engine.MissionEvent.Upserted, { missionID: saved.id })
        return c.json(saved)
      },
    )
    .get(
      "/:id/execs",
      describeRoute({
        summary: "List a mission's execution history",
        description: "Most-recent-first feature/validation execution records for a mission, capped server-side.",
        operationId: "mission.execs",
        responses: {
          200: {
            description: "Execs",
            content: {
              "application/json": {
                schema: resolver(z.object({ execs: z.array(MissionExecDTOSchema) })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().int().positive().max(500).optional(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const { limit } = c.req.valid("query")
        const execs = await Manager.listExecs(id, limit ?? 100)
        return c.json({ execs })
      },
    )
    .get(
      "/execs/recent",
      describeRoute({
        summary: "List recent mission executions across all missions",
        description: "Most-recent-first execution records from every mission in the project.",
        operationId: "mission.recentExecs",
        responses: {
          200: {
            description: "Recent execs",
            content: {
              "application/json": {
                schema: resolver(z.object({ execs: z.array(MissionExecDTOSchema) })),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().int().positive().max(500).optional(),
        }),
      ),
      async (c) => {
        const { limit } = c.req.valid("query")
        const records = await Manager.listRunningExecs()
        return c.json({ execs: records.slice(0, limit ?? 100) })
      },
    )
}

// ── Generate-from-description helper ─────────────────────────────────────────
// Moved to `src/mission/generate.ts`; re-exported here so existing importers
// of the route module keep working.

export { generateFromDescription }

// Re-export MilestoneStatusSchema so the SDK surface stays consistent.
export { MilestoneStatusSchema }
// Suppress unused-import lint for the type alias.
export type { MissionModels }
