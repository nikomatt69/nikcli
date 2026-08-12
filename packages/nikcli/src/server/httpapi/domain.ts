import { Schema } from "effect"

/**
 * Effect Schemas for domain objects that several route groups describe but
 * that only exist as zod schemas in the services themselves.
 *
 * This module holds schemas only — no services, no handlers — so contract
 * modules can describe a loop or a routine without pulling `loop/engine`,
 * `loop/manager`, or the mobile dispatcher into their module graph.
 *
 * Keep each schema in sync with the zod source named in its comment. Groups
 * that serve responses through Effect handlers encode against these at
 * runtime, so a field that drifts here fails the request rather than being
 * silently dropped.
 */

// ── Loops (mirrors `@/loop/schema`) ──────────────────────────────────────────

export const LoopTrigger = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("manual") }),
  Schema.Struct({ kind: Schema.Literal("interval"), everyMs: Schema.Number }),
]).annotate({ identifier: "LoopTrigger" })

export const LoopWorktree = Schema.Struct({
  name: Schema.String,
  branch: Schema.optional(Schema.String),
  directory: Schema.String,
}).annotate({ identifier: "LoopWorktree" })

export const LoopStage = Schema.Struct({
  name: Schema.String,
  agent: Schema.String,
  model: Schema.optional(Schema.String),
  objective: Schema.String,
  tokenBudget: Schema.optional(Schema.Number),
}).annotate({ identifier: "LoopStage" })

export const LoopDefinition = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  stages: Schema.Array(LoopStage),
  trigger: LoopTrigger,
  maxRuns: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
  createPR: Schema.optional(Schema.Boolean),
  sandbox: Schema.optional(Schema.Boolean),
  worktree: Schema.optional(LoopWorktree),
  paused: Schema.optional(Schema.Boolean),
  enabled: Schema.Boolean,
  createdAt: Schema.Number,
}).annotate({ identifier: "LoopDefinition" })

export const LoopPullRequestRef = Schema.Struct({
  number: Schema.Number,
  url: Schema.String,
  branch: Schema.String,
  base: Schema.String,
  title: Schema.optional(Schema.String),
  action: Schema.Literals(["created", "updated"]),
}).annotate({ identifier: "LoopPullRequestRef" })

export const LoopRun = Schema.Struct({
  id: Schema.String,
  loopID: Schema.String,
  startedAt: Schema.Number,
  endedAt: Schema.optional(Schema.Number),
  status: Schema.Literals(["running", "complete", "error", "timeout", "cancelled", "orphaned"]),
  heartbeatAt: Schema.optional(Schema.Number),
  sessionID: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  ok: Schema.Boolean,
  pullRequest: Schema.optional(LoopPullRequestRef),
}).annotate({ identifier: "LoopRun" })

/** `Engine.getRuntime()` merged with the loop id the handlers attach. */
export const LoopRuntime = Schema.Struct({
  loopID: Schema.String,
  status: Schema.Literals(["idle", "running", "paused", "error", "cancelling"]),
  runs: Schema.Number,
  lastRunAt: Schema.optional(Schema.Number),
  lastError: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
}).annotate({ identifier: "LoopRuntime" })

export const LoopTemplate = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  draft: Schema.Struct({
    name: Schema.optional(Schema.String),
    stages: Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        agent: Schema.optional(Schema.String),
        model: Schema.optional(Schema.String),
        objective: Schema.String,
        tokenBudget: Schema.optional(Schema.Number),
      }),
    ),
    intervalMs: Schema.optional(Schema.Number),
    maxRuns: Schema.optional(Schema.Number),
  }),
}).annotate({ identifier: "LoopTemplate" })

// ── Routines (mirrors `Routine` in `@/mobile/routine`) ───────────────────────

export const RoutineTriggerSchedule = Schema.Struct({
  type: Schema.Literal("schedule"),
  cron: Schema.String,
  enabled: Schema.Boolean,
}).annotate({ identifier: "RoutineTriggerSchedule" })

export const RoutineTriggerApi = Schema.Struct({
  type: Schema.Literal("api"),
  token: Schema.String,
  enabled: Schema.Boolean,
}).annotate({ identifier: "RoutineTriggerApi" })

export const RoutineTrigger = Schema.Union([RoutineTriggerSchedule, RoutineTriggerApi]).annotate({
  identifier: "RoutineTrigger",
})

export const Routine = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  triggers: Schema.Array(RoutineTrigger),
  model: Schema.optional(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }),
  ),
  paused: Schema.Boolean,
  projectID: Schema.String,
  directory: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  lastRunAt: Schema.optional(Schema.Number),
  lastSessionID: Schema.optional(Schema.String),
}).annotate({ identifier: "Routine" })
