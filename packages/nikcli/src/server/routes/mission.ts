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
import { Effect } from "effect"
import { Bus } from "../../bus"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { runPromiseWithLayer, withCurrentInstance } from "../../effect"
import * as Engine from "../../mission/orchestrator"
import * as Manager from "../../mission/manager"
import {
  MISSION_TEMPLATES,
  MissionDefinitionSchema,
  MilestoneStatusSchema,
  ExecStatusSchema,
  type MissionDefinition,
  definitionFromGenerated,
  definitionFromGeneratedText,
  generateID,
  validateDefinition,
  type MissionModels,
} from "../../mission/schema"
import { Log } from "../../util/log"
import { errors } from "../error"

const log = Log.create({ service: "mission.routes" })

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
}

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

const GENERATE_SYSTEM_PROMPT = [
  "You design missions for an autonomous coding agent.",
  "A mission is a brief, a sequence of milestones, and within each milestone a set of features.",
  "Each feature is a single, self-contained piece of work that the agent's `goal` command will drive to completion.",
  "Each milestone may end with a validation pass (`scrutiny` review/fix, `user-test` end-to-end check, or `none`).",
  "Prefer 1–3 milestones with 1–4 features each. Use agent 'ralph' for implementation, 'general' for read-only investigation, 'build' for multi-file edits, 'plan' for design.",
  "Use `dependsOn` to express intra-milestone ordering (each entry is a sibling feature id).",
  "Set `models.worker` / `models.validation` / `models.orchestrator` only when the user explicitly asks for a particular model.",
  "Return ONLY a single JSON object — no prose, no code fences.",
  "",
  "Schema:",
  `{`,
  `  "name": "kebab-or-human-name",`,
  `  "brief": "one-paragraph mission goal",`,
  `  "milestones": [`,
  `    { "name": "milestone", "validation": "scrutiny|user-test|none", "features": [`,
  `      { "name": "feature", "agent": "ralph|general|build|plan", "model": "providerID/modelID"?, "objective": "one-paragraph objective", "tokenBudget": number?, "dependsOn": ["f1_1"?] }`,
  `    ] }`,
  `  ],`,
  `  "models": { "worker"?: "provider/model", "validation"?: "provider/model", "orchestrator"?: "provider/model" }`,
  `}`,
  "",
  "Output exactly one JSON object.",
].join("\n")

export async function generateFromDescription(
  description: string,
  opts: { model?: string; agent?: string },
): Promise<MissionDefinition> {
  // Create a throwaway session to ask the configured model to author the plan.
  const session = await runSession(
    Effect.gen(function* () {
      const service = yield* Session.Service
      return yield* service.create({
        title: "mission: generate from description",
      })
    }),
  )
  const modelID = opts.model ?? ""
  const agent = opts.agent ?? "general"

  const userMessage = `${description}\n\nRespond with the JSON object and nothing else. When the JSON is fully emitted, call the update_goal tool with status="complete" and your one-line summary.`

  let text = ""
  try {
    const result = await runSessionPrompt(
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        return yield* prompt.command({
          sessionID: session.id,
          command: "goal",
          arguments: userMessage,
          agent,
          ...(modelID ? { model: modelID } : {}),
        })
      }),
    )
    const parts = result.parts as Array<{ type: string; text?: string }>
    text = parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
  } catch (error) {
    log.warn("mission generate failed", { error })
  }

  if (!text.trim()) throw new Error("The model returned no text")
  try {
    return definitionFromGeneratedText(text)
  } catch (jsonError) {
    try {
      const lenient = parseLenient(text)
      return definitionFromGenerated(lenient)
    } catch {
      throw jsonError
    }
  }
}

type LenientGenerated = Parameters<typeof definitionFromGenerated>[0]

function parseLenient(text: string): LenientGenerated {
  const briefMatch = text.match(/"brief"\s*:\s*"([^"]+)"/)
  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/)
  const milestonesMatch = text.match(/"milestones"\s*:\s*\[([\s\S]*)\]\s*[,\}]/)
  if (!milestonesMatch || !briefMatch) {
    throw new Error("Could not extract mission shape from model output")
  }
  const block = milestonesMatch[1]
  // Split on top-level objects via balanced braces.
  const milestones: Array<{
    name?: string
    validation?: "scrutiny" | "user-test" | "none"
    features: Array<{
      name?: string
      agent?: string
      model?: string
      objective: string
      tokenBudget?: number
      dependsOn?: string[]
    }>
  }> = []
  const objRe = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g
  for (const m of block.matchAll(objRe)) {
    const obj = m[0]
    const featuresMatch = obj.match(/"features"\s*:\s*\[([\s\S]*?)\](?=\s*[,\}])/)
    if (!featuresMatch) continue
    const features: Array<{
      name?: string
      agent?: string
      model?: string
      objective: string
      tokenBudget?: number
      dependsOn?: string[]
    }> = []
    for (const fm of featuresMatch[1].matchAll(objRe)) {
      const fobj = fm[0]
      const objMatch = fobj.match(/"objective"\s*:\s*"([^"]+)"/)
      if (!objMatch) continue
      const feature: {
        name?: string
        agent?: string
        model?: string
        objective: string
        tokenBudget?: number
        dependsOn?: string[]
      } = {
        objective: objMatch[1],
      }
      const n = fobj.match(/"name"\s*:\s*"([^"]+)"/)
      if (n) feature.name = n[1]
      const a = fobj.match(/"agent"\s*:\s*"([^"]+)"/)
      if (a) feature.agent = a[1]
      const mm = fobj.match(/"model"\s*:\s*"([^"]+)"/)
      if (mm) feature.model = mm[1]
      const tb = fobj.match(/"tokenBudget"\s*:\s*(\d+)/)
      if (tb) feature.tokenBudget = Number(tb[1])
      const deps = fobj.match(/"dependsOn"\s*:\s*\[([^\]]*)\]/)
      if (deps) {
        const list = deps[1]
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""))
          .filter((s) => s.length > 0)
        if (list.length) feature.dependsOn = list
      }
      features.push(feature)
    }
    if (features.length === 0) continue
    const milestone: {
      name?: string
      validation?: "scrutiny" | "user-test" | "none"
      features: typeof features
    } = {
      features,
    }
    const mn = obj.match(/"name"\s*:\s*"([^"]+)"/)
    if (mn) milestone.name = mn[1]
    const mv = obj.match(/"validation"\s*:\s*"([^"]+)"/)
    if (mv && (mv[1] === "scrutiny" || mv[1] === "user-test" || mv[1] === "none")) {
      milestone.validation = mv[1] as "scrutiny" | "user-test" | "none"
    }
    milestones.push(milestone)
  }
  if (milestones.length === 0) throw new Error("No milestones could be extracted")
  const out: LenientGenerated = { brief: briefMatch[1], milestones }
  if (nameMatch) out.name = nameMatch[1]
  return out
}

// Re-export MilestoneStatusSchema so the SDK surface stays consistent.
export { MilestoneStatusSchema }
// Suppress unused-import lint for the type alias.
export type { MissionModels }
