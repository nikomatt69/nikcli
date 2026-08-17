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
  branch: Schema.optionalKey(Schema.String),
  directory: Schema.String,
}).annotate({ identifier: "LoopWorktree" })

export const LoopStage = Schema.Struct({
  name: Schema.String,
  agent: Schema.String,
  model: Schema.optionalKey(Schema.String),
  objective: Schema.String,
  tokenBudget: Schema.optionalKey(Schema.Number),
}).annotate({ identifier: "LoopStage" })

/**
 * Everything about a loop that the author supplies. `id`, `createdAt` and
 * `enabled` are deliberately absent: the server assigns the first two and
 * defaults the third.
 *
 * Split out so the definition and the create body share one list. `Schema.Struct`
 * **strips** undeclared keys on decode, so a create body restated by hand would
 * silently drop any field it forgot — on the write path, where the loss is
 * durable. Adding a field here reaches both shapes at once.
 */
const LoopAuthoredFields = {
  name: Schema.String,
  stages: Schema.Array(LoopStage),
  trigger: LoopTrigger,
  maxRuns: Schema.optionalKey(Schema.Number),
  timeoutMs: Schema.optionalKey(Schema.Number),
  createPR: Schema.optionalKey(Schema.Boolean),
  sandbox: Schema.optionalKey(Schema.Boolean),
  worktree: Schema.optionalKey(LoopWorktree),
  paused: Schema.optionalKey(Schema.Boolean),
}

export const LoopDefinition = Schema.Struct({
  id: Schema.String,
  ...LoopAuthoredFields,
  enabled: Schema.Boolean,
  createdAt: Schema.Number,
}).annotate({ identifier: "LoopDefinition" })

/** Create body: the authored fields, with `enabled` optional (handler defaults it to `true`). */
export const LoopCreateInput = Schema.Struct({
  ...LoopAuthoredFields,
  enabled: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "LoopCreateInput" })

/**
 * Update body: the whole definition except `id`, which the path already carries.
 *
 * `id` is left out because the generated clients flatten path params and body
 * fields into one argument object, so a body `id` beside `/:id` is a field
 * collision the codegen rejects outright. Dropping it is also the shape the
 * rest of this surface already uses — `ProjectUpdateInput` and
 * `SessionUpdateInput` both keep identity in the path.
 */
export const LoopUpdateInput = Schema.Struct({
  ...LoopAuthoredFields,
  enabled: Schema.Boolean,
  createdAt: Schema.Number,
}).annotate({ identifier: "LoopUpdateInput" })

export const LoopPullRequestRef = Schema.Struct({
  number: Schema.Number,
  url: Schema.String,
  branch: Schema.String,
  base: Schema.String,
  title: Schema.optionalKey(Schema.String),
  action: Schema.Literals(["created", "updated"]),
}).annotate({ identifier: "LoopPullRequestRef" })

export const LoopRun = Schema.Struct({
  id: Schema.String,
  loopID: Schema.String,
  startedAt: Schema.Number,
  endedAt: Schema.optionalKey(Schema.Number),
  status: Schema.Literals(["running", "complete", "error", "timeout", "cancelled", "orphaned"]),
  heartbeatAt: Schema.optionalKey(Schema.Number),
  sessionID: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  ok: Schema.Boolean,
  pullRequest: Schema.optionalKey(LoopPullRequestRef),
}).annotate({ identifier: "LoopRun" })

/** `Engine.getRuntime()` merged with the loop id the handlers attach. */
export const LoopRuntime = Schema.Struct({
  loopID: Schema.String,
  status: Schema.Literals(["idle", "running", "paused", "error", "cancelling"]),
  runs: Schema.Number,
  lastRunAt: Schema.optionalKey(Schema.Number),
  lastError: Schema.optionalKey(Schema.String),
  sessionID: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "LoopRuntime" })

export const LoopTemplate = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  draft: Schema.Struct({
    name: Schema.optionalKey(Schema.String),
    stages: Schema.Array(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        agent: Schema.optionalKey(Schema.String),
        model: Schema.optionalKey(Schema.String),
        objective: Schema.String,
        tokenBudget: Schema.optionalKey(Schema.Number),
      }),
    ),
    intervalMs: Schema.optionalKey(Schema.Number),
    maxRuns: Schema.optionalKey(Schema.Number),
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
  model: Schema.optionalKey(
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
  lastRunAt: Schema.optionalKey(Schema.Number),
  lastSessionID: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Routine" })
