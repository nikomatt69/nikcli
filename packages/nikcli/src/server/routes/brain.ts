/**
 * Brain — HTTP routes for memory consolidation.
 *
 * The TUI exposes `/brain` via a command; this mirrors the same surface so the
 * desktop/web/mobile clients can inspect brain status and trigger a run.
 * Request instance context (directory/workspace) is established by the global
 * server middleware, so handlers can call the Brain module directly.
 */

import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Brain, getBrainConfig, getSessionsCountSince, readLastBrainAt } from "../../brain"
import { Log } from "../../util/log"
import { errors } from "../error"

const log = Log.create({ service: "brain.routes" })

const HOUR_MS = 60 * 60 * 1000

const BrainStatusSchema = z
  .object({
    enabled: z.boolean(),
    memoryEnabled: z.boolean(),
    minHours: z.number(),
    minSessions: z.number(),
    lastBrainAt: z.number(),
    hoursSinceLastBrain: z.number(),
    sessionsSinceLastBrain: z.number(),
    shouldTrigger: z.boolean(),
    model: z.object({ providerID: z.string(), modelID: z.string() }).optional(),
  })
  .meta({ ref: "BrainStatus" })

const BrainTriggerInputSchema = z
  .object({
    force: z.boolean().optional(),
  })
  .meta({ ref: "BrainTriggerInput" })

const BrainResultSchema = z
  .object({
    success: z.boolean(),
    sessionsReviewed: z.number(),
    hoursSinceLastBrain: z.number(),
    error: z.string().optional(),
    sessionID: z.string().optional(),
  })
  .meta({ ref: "BrainResult" })

export function BrainRoutes() {
  return new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get brain status",
        description: "Memory-consolidation configuration and readiness.",
        operationId: "brain.status",
        responses: {
          200: {
            description: "Brain status",
            content: { "application/json": { schema: resolver(BrainStatusSchema) } },
          },
        },
      }),
      async (c) => {
        const cfg = await getBrainConfig()
        const lastBrainAt = await readLastBrainAt()
        const hoursSinceLastBrain = lastBrainAt ? (Date.now() - lastBrainAt) / HOUR_MS : Number.POSITIVE_INFINITY
        const sessionsSinceLastBrain = await getSessionsCountSince(lastBrainAt)
        const shouldTrigger = await Brain.shouldTrigger().catch(() => false)
        return c.json({
          enabled: cfg.enabled,
          memoryEnabled: cfg.memoryEnabled,
          minHours: cfg.minHours,
          minSessions: cfg.minSessions,
          lastBrainAt,
          hoursSinceLastBrain: Number.isFinite(hoursSinceLastBrain) ? hoursSinceLastBrain : -1,
          sessionsSinceLastBrain,
          shouldTrigger,
          model: cfg.model,
        })
      },
    )
    .post(
      "/trigger",
      describeRoute({
        summary: "Trigger brain run",
        description: "Run a memory-consolidation session now. Pass force to bypass thresholds.",
        operationId: "brain.trigger",
        responses: {
          200: {
            description: "Brain run result",
            content: { "application/json": { schema: resolver(BrainResultSchema) } },
          },
          ...errors(400),
        },
      }),
      validator("json", BrainTriggerInputSchema),
      async (c) => {
        const { force } = c.req.valid("json")
        log.info("brain trigger requested", { force })
        const result = await Brain.trigger({ force })
        return c.json(result)
      },
    )
}
