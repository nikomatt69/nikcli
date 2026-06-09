/**
 * Loops — HTTP routes for the headless engine.
 *
 * The TUI plugin remains the primary user-facing surface, but the same data
 * shape is exposed here so:
 *   - other clients (mobile, web) can manage loops;
 *   - the engine runs with the TUI closed.
 *
 * All write endpoints mutate persisted state and emit `LoopEvent.*` bus events
 * so live TUI subscribers stay in sync.
 */

import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { Bus } from "../../bus"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { runPromiseWithLayer, withCurrentInstance } from "../../effect"
import * as Engine from "../../loop/engine"
import * as Manager from "../../loop/manager"
import {
  LOOP_TEMPLATES,
  LoopDefinitionSchema,
  LoopRunStatusSchema,
  type LoopDefinition,
  definitionFromGenerated,
  definitionFromGeneratedText,
  generateID,
  validateDefinition,
} from "../../loop/schema"
import { Log } from "../../util/log"
import { errors } from "../error"

const log = Log.create({ service: "loop.routes" })

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
}

const LoopRuntimeSchema = z
  .object({
    loopID: z.string(),
    status: z.enum(["idle", "running", "paused", "error", "cancelling"]),
    runs: z.number(),
    lastRunAt: z.number().optional(),
    lastError: z.string().optional(),
    sessionID: z.string().optional(),
  })
  .meta({ ref: "LoopRuntime" })

const LoopDefinitionDTOSchema = LoopDefinitionSchema.meta({
  ref: "LoopDefinition",
})

const LoopRunDTOSchema = z
  .object({
    id: z.string(),
    loopID: z.string(),
    startedAt: z.number(),
    endedAt: z.number().optional(),
    status: LoopRunStatusSchema,
    ok: z.boolean(),
    error: z.string().optional(),
    sessionID: z.string().optional(),
    backgroundRunID: z.string().optional(),
  })
  .meta({ ref: "LoopRun" })

const LoopTemplateDTOSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    draft: z.object({
      name: z.string().optional(),
      stages: z.array(
        z.object({
          name: z.string().optional(),
          agent: z.string().optional(),
          model: z.string().optional(),
          objective: z.string(),
          tokenBudget: z.number().optional(),
        }),
      ),
      intervalMs: z.number().optional(),
      maxRuns: z.number().optional(),
    }),
  })
  .meta({ ref: "LoopTemplate" })

const CreateInput = LoopDefinitionSchema.omit({ id: true, createdAt: true })
const UpdateInput = LoopDefinitionSchema

export function LoopRoutes() {
  return new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List loops",
        description: "List all loops defined for the current project, with live runtime status.",
        operationId: "loop.list",
        responses: {
          200: {
            description: "All loops with runtime status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    loops: LoopDefinitionDTOSchema.array(),
                    runtimes: z.array(LoopRuntimeSchema),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const loops = await Manager.list()
        const runtimes = loops.map((loop) => ({
          loopID: loop.id,
          ...Engine.getRuntime(loop.id),
        }))
        return c.json({ loops, runtimes })
      },
    )
    .get(
      "/templates",
      describeRoute({
        summary: "List loop templates",
        description: "Built-in starter pipelines the user can instantiate from the wizard.",
        operationId: "loop.templates",
        responses: {
          200: {
            description: "Templates",
            content: {
              "application/json": {
                schema: resolver(z.object({ templates: z.array(LoopTemplateDTOSchema) })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ templates: LOOP_TEMPLATES })
      },
    )
    .post(
      "/generate",
      describeRoute({
        summary: "Generate a loop from a description",
        description:
          "Send a natural-language description to an AI and parse the response back into a fully-formed loop definition. The response is a draft — the user still confirms before persistence.",
        operationId: "loop.generate",
        responses: {
          200: {
            description: "Generated loop definition",
            content: {
              "application/json": {
                schema: resolver(LoopDefinitionDTOSchema),
              },
            },
          },
          ...errors(400, 404, 500),
        },
      }),
      validator(
        "json",
        z.object({
          description: z.string().min(1).meta({ description: "Natural-language description of the loop" }),
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
        summary: "Get a loop",
        description: "Fetch a single loop definition by id, including its live runtime status.",
        operationId: "loop.get",
        responses: {
          200: {
            description: "The loop",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    loop: LoopDefinitionDTOSchema,
                    runtime: LoopRuntimeSchema,
                  }),
                ),
              },
            },
          },
          404: { description: "Loop not found" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const loop = await Manager.get(id)
        if (!loop) return c.json({ name: "NotFound", data: { message: `Loop "${id}" not found` } }, 404)
        return c.json({
          loop,
          runtime: { loopID: id, ...Engine.getRuntime(id) },
        })
      },
    )
    .put(
      "/",
      describeRoute({
        summary: "Create or update a loop",
        description: "Persist a loop definition. Generates the id and createdAt for new loops.",
        operationId: "loop.upsert",
        responses: {
          200: {
            description: "Persisted loop",
            content: {
              "application/json": {
                schema: resolver(LoopDefinitionDTOSchema),
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
        const def: LoopDefinition = {
          ...body,
          id,
          createdAt: Date.now(),
          enabled: body.enabled ?? true,
        }
        const err = validateDefinition(def)
        if (err) return c.json({ name: "ValidationError", data: { message: err } }, 400)
        const saved = await Manager.upsert(def)
        await Engine.sync(saved.id)
        void Bus.publish(Engine.LoopEvent.Upserted, { loopID: saved.id })
        return c.json(saved)
      },
    )
    .post(
      "/:id",
      describeRoute({
        summary: "Update a loop",
        description: "Replace a loop definition. Re-arms its scheduler entry if trigger/enabled changed.",
        operationId: "loop.update",
        responses: {
          200: {
            description: "Updated loop",
            content: {
              "application/json": {
                schema: resolver(LoopDefinitionDTOSchema),
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
        if (!existing) return c.json({ name: "NotFound", data: { message: `Loop "${id}" not found` } }, 404)
        const saved = await Manager.upsert(body)
        await Engine.sync(saved.id)
        void Bus.publish(Engine.LoopEvent.Upserted, { loopID: saved.id })
        return c.json(saved)
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete a loop",
        description:
          "Remove a loop and its run history. Cancels any in-flight run, disarms its scheduler entry, and cascade-deletes run records.",
        operationId: "loop.delete",
        responses: {
          200: { description: "Deleted" },
          404: { description: "Loop not found" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const def = await Manager.get(id)
        if (!def) return c.json({ name: "NotFound", data: { message: `Loop "${id}" not found` } }, 404)
        // Cancel any in-flight run *before* removing the definition so no
        // orphan `LoopRun` is written for a loop the user just deleted.
        await Engine.cancelRun(id).catch((error) => {
          log.warn("cancelRun on delete failed", { id, error })
        })
        const removed = await Manager.remove(id)
        if (!removed) return c.json({ name: "NotFound", data: { message: `Loop "${id}" not found` } }, 404)
        Engine.disarm(id)
        void Bus.publish(Engine.LoopEvent.Removed, { loopID: id })
        return c.json(true)
      },
    )
    .post(
      "/:id/toggle",
      describeRoute({
        summary: "Enable or disable a loop",
        description: "Set the loop's enabled flag. Disarmed timers are removed when disabling.",
        operationId: "loop.toggle",
        responses: {
          200: { description: "Updated loop" },
          404: { description: "Loop not found" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator("json", z.object({ enabled: z.boolean() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const { enabled } = c.req.valid("json")
        const next = await Manager.setEnabled(id, enabled)
        if (!next) return c.json({ name: "NotFound", data: { message: `Loop "${id}" not found` } }, 404)
        await Engine.sync(id)
        void Bus.publish(Engine.LoopEvent.Upserted, { loopID: id })
        return c.json(next)
      },
    )
    .post(
      "/:id/run",
      describeRoute({
        summary: "Run a loop once",
        description: "Trigger an immediate run of the loop, ignoring its schedule.",
        operationId: "loop.run",
        responses: {
          200: { description: "Run started" },
          404: { description: "Loop not found" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const def = await Manager.get(id)
        if (!def) return c.json({ name: "NotFound", data: { message: `Loop "${id}" not found` } }, 404)
        // Fire and forget: the engine writes its own run record and publishes events.
        void Engine.runOnce(id)
        return c.json(true)
      },
    )
    .post(
      "/:id/pause",
      describeRoute({
        summary: "Pause a loop",
        description: "Set runtime status to paused; the scheduler entry is removed until resumed.",
        operationId: "loop.pause",
        responses: {
          200: { description: "Paused" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        Engine.disarm(id)
        // Mutate runtime directly via the public resetRunCount + a synthetic patch.
        // We re-use the engine's internal patch by importing listRuntimes/resetRunCount is not enough;
        // expose the runtime mutator via a dedicated route helper.
        Engine.setRuntimeStatus(id, "paused")
        return c.json(true)
      },
    )
    .post(
      "/:id/resume",
      describeRoute({
        summary: "Resume a loop",
        description: "Clear the paused state and re-arm the scheduler entry if the loop has an interval trigger.",
        operationId: "loop.resume",
        responses: {
          200: { description: "Resumed" },
          404: { description: "Loop not found" },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const def = await Manager.get(id)
        if (!def) return c.json({ name: "NotFound", data: { message: `Loop "${id}" not found` } }, 404)
        Engine.setRuntimeStatus(id, "idle")
        await Engine.sync(id)
        return c.json(true)
      },
    )
    .get(
      "/:id/runs",
      describeRoute({
        summary: "List a loop's runs",
        description: "Most-recent-first run history for a loop, capped server-side.",
        operationId: "loop.runs",
        responses: {
          200: {
            description: "Runs",
            content: {
              "application/json": {
                schema: resolver(z.object({ runs: z.array(LoopRunDTOSchema) })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().int().positive().max(200).optional(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const { limit } = c.req.valid("query")
        const runs = await Manager.listRuns(id, limit ?? 50)
        return c.json({ runs })
      },
    )
    .get(
      "/runs/recent",
      describeRoute({
        summary: "List recent loop runs across all loops",
        description: "Most-recent-first runs from every loop in the project, useful for a global activity view.",
        operationId: "loop.recentRuns",
        responses: {
          200: {
            description: "Recent runs",
            content: {
              "application/json": {
                schema: resolver(z.object({ runs: z.array(LoopRunDTOSchema) })),
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
        const runs = await Manager.listAllRunsAcrossLoops(limit ?? 100)
        return c.json({ runs })
      },
    )
}

// ── Generate-from-description helper ─────────────────────────────────────────

const GENERATE_SYSTEM_PROMPT = [
  "You design pipelines (loops) for an autonomous coding agent.",
  "Return ONLY a single JSON object matching the schema below — no prose, no code fences.",
  "Each stage is a single prompt-driven step executed by the agent.",
  "Prefer 1–3 stages. Use agent 'ralph' for implementation, 'general' for read-only investigation, 'build' for multi-file edits, 'plan' for design.",
  "If a schedule is implied, set intervalMs in milliseconds (>= 30000).",
  "If a cap is implied, set maxRuns to a positive integer.",
  "",
  "Schema:",
  `{`,
  `  "name": "kebab-or-human-name",`,
  `  "stages": [`,
  `    { "name": "stage-name", "agent": "ralph|general|build|plan", "model": "providerID/modelID"?, "objective": "one-paragraph objective", "tokenBudget": number? }`,
  `  ],`,
  `  "intervalMs"?: number,`,
  `  "maxRuns"?: number`,
  `}`,
  "",
  "Output exactly one JSON object.",
].join("\n")

export async function generateFromDescription(
  description: string,
  opts: { model?: string; agent?: string },
): Promise<LoopDefinition> {
  // Create a throwaway session to ask the configured model to author the pipeline.
  const session = await runSession(
    Effect.gen(function* () {
      const service = yield* Session.Service
      return yield* service.create({
        title: "loop: generate from description",
      })
    }),
  )
  const modelID = opts.model ?? ""
  const agent = opts.agent ?? "general"

  // Compose the prompt: we use the "goal" command so the model is guided into a
  // single, well-formed response. The model is asked to "declare complete" once
  // it has output the JSON.
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
    // The goal command returns the first assistant turn; the model may iterate.
    // We don't wait for full iteration here — the first turn is usually enough
    // to extract the JSON, and the user can re-roll if the schema is incomplete.
    const parts = result.parts as Array<{ type: string; text?: string }>
    text = parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
  } catch (error) {
    log.warn("generate failed", { error })
    // Fall through to parsing whatever we got; if empty, throw.
  }

  if (!text.trim()) throw new Error("The model returned no text")
  try {
    return definitionFromGeneratedText(text)
  } catch (jsonError) {
    // Last-ditch: try parsing a more lenient shape.
    try {
      const lenient = parseLenient(text)
      return definitionFromGenerated(lenient)
    } catch {
      throw jsonError
    }
  }
}

function parseLenient(text: string): Parameters<typeof definitionFromGenerated>[0] {
  // Try a quick & dirty regex extraction if the strict path failed.
  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/)
  const stagesMatch = text.match(/"stages"\s*:\s*\[([\s\S]*?)\]\s*[,\}]/)
  const intervalMatch = text.match(/"intervalMs"\s*:\s*(\d+)/)
  const maxRunsMatch = text.match(/"maxRuns"\s*:\s*(\d+)/)
  if (!stagesMatch) throw new Error("Could not extract stages from model output")
  const stages: Array<{
    name?: string
    agent?: string
    model?: string
    objective: string
    tokenBudget?: number
  }> = []
  const stageRe = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g
  for (const m of stagesMatch[1].matchAll(stageRe)) {
    const obj = m[0]
    const objMatch = obj.match(/"objective"\s*:\s*"([^"]+)"/)
    if (!objMatch) continue
    const stage: {
      name?: string
      agent?: string
      model?: string
      objective: string
      tokenBudget?: number
    } = {
      objective: objMatch[1],
    }
    const n = obj.match(/"name"\s*:\s*"([^"]+)"/)
    if (n) stage.name = n[1]
    const a = obj.match(/"agent"\s*:\s*"([^"]+)"/)
    if (a) stage.agent = a[1]
    const m2 = obj.match(/"model"\s*:\s*"([^"]+)"/)
    if (m2) stage.model = m2[1]
    const tb = obj.match(/"tokenBudget"\s*:\s*(\d+)/)
    if (tb) stage.tokenBudget = Number(tb[1])
    stages.push(stage)
  }
  if (stages.length === 0) throw new Error("No stages could be extracted")
  return {
    stages,
    ...(nameMatch ? { name: nameMatch[1] } : {}),
    ...(intervalMatch ? { intervalMs: Number(intervalMatch[1]) } : {}),
    ...(maxRunsMatch ? { maxRuns: Number(maxRunsMatch[1]) } : {}),
  }
}
