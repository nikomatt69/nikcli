import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Routine } from "@/mobile/routine"
import * as LoopEngine from "@/loop/engine"
import * as LoopManager from "@/loop/manager"
import {
  LOOP_TEMPLATES,
  generateID as generateLoopID,
  validateDefinition as validateLoopDefinition,
  type LoopDefinition,
} from "@/loop/schema"
import { errors } from "../../error"
import { generateFromDescription as generateLoopFromDescription } from "../loop"
import { withInstanceAsync } from "@/effect"
import {
  log,
  MobileRoutine,
  MobileRoutineCreateInput,
  MobileRoutineUpdateInput,
  MobileRoutineRunInput,
  MobileRoutineTriggerInput,
  MobileLoopRuntime,
  MobileLoop,
  MobileLoopRun,
  MobileLoopWriteInput,
  MobileLoopGenerateInput,
  MobileLoopTemplate,
} from "./helpers"

export const LoopsRoutes = () =>
  new Hono()
    // ── Loops ────────────────────────────────────────────────────────────────
    .get(
      "/loops",
      describeRoute({
        summary: "List loops for mobile",
        description: "List all autonomous loops for the current project with their live runtime state.",
        operationId: "mobile.loop.list",
        responses: {
          200: {
            description: "Loop list and runtimes",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    loops: z.array(MobileLoop),
                    runtimes: z.array(MobileLoopRuntime),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const loops = await LoopManager.list()
          return c.json({
            loops,
            runtimes: loops.map((loop) => ({
              loopID: loop.id,
              ...LoopEngine.getRuntime(loop.id),
            })),
          })
        })
      },
    )
    .get(
      "/loops/templates",
      describeRoute({
        summary: "List loop templates for mobile",
        description: "List built-in loop starters that can be applied in the mobile loop editor.",
        operationId: "mobile.loop.templates",
        responses: {
          200: {
            description: "Loop templates",
            content: {
              "application/json": {
                schema: resolver(z.object({ templates: z.array(MobileLoopTemplate) })),
              },
            },
          },
        },
      }),
      async (c) => c.json({ templates: LOOP_TEMPLATES }),
    )
    .post(
      "/loops/generate",
      describeRoute({
        summary: "Generate a loop for mobile",
        description: "Generate a loop draft from a natural-language description.",
        operationId: "mobile.loop.generate",
        responses: {
          200: {
            description: "Generated loop draft",
            content: { "application/json": { schema: resolver(MobileLoop) } },
          },
          ...errors(400, 500),
        },
      }),
      validator("json", MobileLoopGenerateInput),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const body = c.req.valid("json")
          return c.json(
            await generateLoopFromDescription(body.description, {
              model: body.model,
              agent: body.agent,
            }),
          )
        })
      },
    )
    .get(
      "/loops/runs/recent",
      describeRoute({
        summary: "List recent loop runs for mobile",
        description: "List recent runs across all loops in the current project.",
        operationId: "mobile.loop.runs.recent",
        responses: {
          200: {
            description: "Recent loop runs",
            content: { "application/json": { schema: resolver(z.object({ runs: z.array(MobileLoopRun) })) } },
          },
          ...errors(400),
        },
      }),
      validator("query", z.object({ limit: z.coerce.number().int().positive().max(200).optional() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          return c.json({ runs: await LoopManager.listAllRunsAcrossLoops(c.req.valid("query").limit ?? 50) })
        })
      },
    )
    .post(
      "/loops",
      describeRoute({
        summary: "Create loop for mobile",
        description: "Create and arm a new autonomous loop.",
        operationId: "mobile.loop.create",
        responses: {
          200: {
            description: "Created loop",
            content: { "application/json": { schema: resolver(MobileLoop) } },
          },
          ...errors(400),
        },
      }),
      validator("json", MobileLoopWriteInput),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const body = c.req.valid("json")
          const loop: LoopDefinition = {
            ...body,
            id: generateLoopID(),
            createdAt: Date.now(),
            enabled: body.enabled ?? true,
          }
          const validationError = validateLoopDefinition(loop)
          if (validationError) return c.json({ error: validationError }, 400)
          const saved = await LoopManager.upsert(loop)
          await LoopEngine.sync(saved.id)
          void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: saved.id })
          return c.json(saved)
        })
      },
    )
    .get(
      "/loops/:id",
      describeRoute({
        summary: "Get loop for mobile",
        description: "Get a loop definition and its live runtime.",
        operationId: "mobile.loop.get",
        responses: {
          200: {
            description: "Loop detail",
            content: {
              "application/json": {
                schema: resolver(z.object({ loop: MobileLoop, runtime: MobileLoopRuntime })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          const loop = await LoopManager.get(id)
          if (!loop) return c.json({ error: `Loop "${id}" not found` }, 404)
          return c.json({ loop, runtime: { loopID: id, ...LoopEngine.getRuntime(id) } })
        })
      },
    )
    .patch(
      "/loops/:id",
      describeRoute({
        summary: "Update loop for mobile",
        description: "Replace a loop definition and synchronize its schedule.",
        operationId: "mobile.loop.update",
        responses: {
          200: {
            description: "Updated loop",
            content: { "application/json": { schema: resolver(MobileLoop) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator("json", MobileLoopWriteInput),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          const existing = await LoopManager.get(id)
          if (!existing) return c.json({ error: `Loop "${id}" not found` }, 404)
          const next: LoopDefinition = {
            ...c.req.valid("json"),
            id,
            createdAt: existing.createdAt,
          }
          const validationError = validateLoopDefinition(next)
          if (validationError) return c.json({ error: validationError }, 400)
          const saved = await LoopManager.upsert(next)
          await LoopEngine.sync(id)
          void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: id })
          return c.json(saved)
        })
      },
    )
    .delete(
      "/loops/:id",
      describeRoute({
        summary: "Delete loop for mobile",
        description: "Cancel, disarm, and delete a loop and its run history.",
        operationId: "mobile.loop.delete",
        responses: {
          200: {
            description: "Deletion result",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          if (!(await LoopManager.get(id))) return c.json({ error: `Loop "${id}" not found` }, 404)
          await LoopEngine.cancelRun(id)
          await LoopManager.remove(id)
          LoopEngine.disarm(id)
          void Bus.publish(LoopEngine.LoopEvent.Removed, { loopID: id })
          return c.json({ success: true as const })
        })
      },
    )
    .get(
      "/loops/:id/runs",
      describeRoute({
        summary: "List loop runs for mobile",
        description: "List the most recent runs for one loop.",
        operationId: "mobile.loop.runs",
        responses: {
          200: {
            description: "Loop runs",
            content: { "application/json": { schema: resolver(z.object({ runs: z.array(MobileLoopRun) })) } },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator("query", z.object({ limit: z.coerce.number().int().positive().max(200).optional() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          return c.json({ runs: await LoopManager.listRuns(id, c.req.valid("query").limit ?? 50) })
        })
      },
    )
    .post(
      "/loops/:id/run",
      describeRoute({
        summary: "Run loop from mobile",
        description: "Trigger an immediate run of a loop.",
        operationId: "mobile.loop.run",
        responses: {
          200: {
            description: "Run accepted",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          if (!(await LoopManager.get(id))) return c.json({ error: `Loop "${id}" not found` }, 404)
          void LoopEngine.runOnce(id).catch((error) => {
            log.error("loop run failed", { id, error })
          })
          return c.json({ success: true as const })
        })
      },
    )
    .post(
      "/loops/:id/abort",
      describeRoute({
        summary: "Abort loop from mobile",
        description: "Cancel the currently running iteration of a loop.",
        operationId: "mobile.loop.abort",
        responses: {
          200: {
            description: "Abort completed",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          if (!(await LoopManager.get(id))) return c.json({ error: `Loop "${id}" not found` }, 404)
          await LoopEngine.cancelRun(id)
          return c.json({ success: true as const })
        })
      },
    )
    .post(
      "/loops/:id/toggle",
      describeRoute({
        summary: "Enable or disable loop from mobile",
        description: "Enable or disable a loop and synchronize its schedule.",
        operationId: "mobile.loop.toggle",
        responses: {
          200: {
            description: "Updated loop",
            content: { "application/json": { schema: resolver(MobileLoop) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator("json", z.object({ enabled: z.boolean() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          const next = await LoopManager.setEnabled(id, c.req.valid("json").enabled)
          if (!next) return c.json({ error: `Loop "${id}" not found` }, 404)
          await LoopEngine.sync(id)
          void Bus.publish(LoopEngine.LoopEvent.Upserted, { loopID: id })
          return c.json(next)
        })
      },
    )
    .post(
      "/loops/:id/pause",
      describeRoute({
        summary: "Pause loop from mobile",
        description: "Pause a loop's interval scheduling.",
        operationId: "mobile.loop.pause",
        responses: {
          200: {
            description: "Pause completed",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          if (!(await LoopManager.get(id))) return c.json({ error: `Loop "${id}" not found` }, 404)
          LoopEngine.disarm(id)
          LoopEngine.setRuntimeStatus(id, "paused")
          return c.json({ success: true as const })
        })
      },
    )
    .post(
      "/loops/:id/resume",
      describeRoute({
        summary: "Resume loop from mobile",
        description: "Resume a paused loop and re-arm its interval schedule.",
        operationId: "mobile.loop.resume",
        responses: {
          200: {
            description: "Resume completed",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          if (!(await LoopManager.get(id))) return c.json({ error: `Loop "${id}" not found` }, 404)
          LoopEngine.setRuntimeStatus(id, "idle")
          await LoopEngine.sync(id)
          return c.json({ success: true as const })
        })
      },
    )
    // ── Routines ─────────────────────────────────────────────────────────────
    .get(
      "/routines",
      describeRoute({
        summary: "List routines",
        description: "List all saved routines for the current project.",
        operationId: "mobile.routine.list",
        responses: {
          200: {
            description: "Routine list",
            content: { "application/json": { schema: resolver(z.array(MobileRoutine)) } },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          return c.json(await Routine.list())
        })
      },
    )
    .post(
      "/routines",
      describeRoute({
        summary: "Create routine",
        description: "Create a new saved routine.",
        operationId: "mobile.routine.create",
        responses: {
          200: {
            description: "Created routine",
            content: { "application/json": { schema: resolver(MobileRoutine) } },
          },
          ...errors(400),
        },
      }),
      validator("json", MobileRoutineCreateInput),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const body = c.req.valid("json")
          return c.json(await Routine.create(body))
        })
      },
    )
    .get(
      "/routines/:id",
      describeRoute({
        summary: "Get routine",
        description: "Get a single routine by ID.",
        operationId: "mobile.routine.get",
        responses: {
          200: {
            description: "Routine",
            content: { "application/json": { schema: resolver(MobileRoutine) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          return c.json(await Routine.get(id))
        })
      },
    )
    .patch(
      "/routines/:id",
      describeRoute({
        summary: "Update routine",
        description: "Update a routine's name, prompt, triggers, or paused state.",
        operationId: "mobile.routine.update",
        responses: {
          200: {
            description: "Updated routine",
            content: { "application/json": { schema: resolver(MobileRoutine) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator("json", MobileRoutineUpdateInput),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          const body = c.req.valid("json")
          return c.json(await Routine.update(id, body))
        })
      },
    )
    .delete(
      "/routines/:id",
      describeRoute({
        summary: "Delete routine",
        description: "Delete a routine by ID.",
        operationId: "mobile.routine.delete",
        responses: {
          200: {
            description: "Deletion result",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          await Routine.remove(id)
          return c.json({ success: true as const })
        })
      },
    )
    .post(
      "/routines/:id/run",
      describeRoute({
        summary: "Run routine",
        description: "Trigger an immediate run of a routine, creating a new session.",
        operationId: "mobile.routine.run",
        responses: {
          200: {
            description: "Created session",
            content: { "application/json": { schema: resolver(Session.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator("json", MobileRoutineRunInput.optional()),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          const body = c.req.valid("json")
          const session = await Routine.run(id, { text: body?.text })
          return c.json(session)
        })
      },
    )
    .post(
      "/routines/:id/pause",
      describeRoute({
        summary: "Pause routine",
        description: "Pause a routine, preventing scheduled triggers from firing.",
        operationId: "mobile.routine.pause",
        responses: {
          200: {
            description: "Updated routine",
            content: { "application/json": { schema: resolver(MobileRoutine) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          return c.json(await Routine.pause(id))
        })
      },
    )
    .post(
      "/routines/:id/resume",
      describeRoute({
        summary: "Resume routine",
        description: "Resume a paused routine, re-enabling scheduled triggers.",
        operationId: "mobile.routine.resume",
        responses: {
          200: {
            description: "Updated routine",
            content: { "application/json": { schema: resolver(MobileRoutine) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { id } = c.req.valid("param")
          return c.json(await Routine.resume(id))
        })
      },
    )
    .post(
      "/routines/trigger/:token",
      describeRoute({
        summary: "API trigger",
        description:
          "Trigger a routine via its API token. Accepts the token in the path or Authorization: Bearer header.",
        operationId: "mobile.routine.trigger",
        responses: {
          200: {
            description: "Created session",
            content: { "application/json": { schema: resolver(Session.Info) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ token: z.string() })),
      validator("json", MobileRoutineTriggerInput.optional()),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const { token: pathToken } = c.req.valid("param")
          const authorization = c.req.header("authorization")
          const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
          const token = bearerToken || pathToken
          const body = c.req.valid("json")
          const routine = await Routine.getByToken(token)
          if (!routine) {
            return c.json({ error: "Routine not found or API trigger disabled" }, 404)
          }
          const session = await Routine.run(routine.id, { text: body?.text })
          return c.json(session)
        })
      },
    )
