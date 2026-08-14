/**
 * Loops — persisted schema and pure helpers for the headless engine.
 *
 * Mirrors the TUI plugin's `store.ts` so the on-disk shape is identical when
 * the same data flows through the server. Keep this module free of
 * Scheduler/Session/OpenTUI imports so it can be unit-tested in isolation.
 */

import z from "zod"
import { Schema } from "effect"
import { zod } from "@nikcli-ai/util/effect-zod"
import { Log } from "@nikcli-ai/util/log"

export const MIN_INTERVAL_MS = 30_000
export const MAX_CONCURRENT_RUNS = 3
export const HISTORY_LIMIT = 50

/**
 * How long a `running` LoopRun can stay untouched before `restore()` declares it
 * orphaned. Mirrors `BackgroundRun.LEASE_TIMEOUT_MS` (`src/background/run.ts`).
 */
export const LOOP_RUN_LEASE_MS = 15_000

/**
 * Upper bound for interval triggers. Prevents adversarial or accidental
 * trillion-ms intervals that the user can never cancel.
 */
export const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Run timeout bounds. Every run is capped (default 60 min) so a hung stage
 * can never hold the single-flight slot forever; `timeoutMs` on the
 * definition overrides the default within [MIN, MAX].
 */
export const DEFAULT_RUN_TIMEOUT_MS = 60 * 60_000
export const MIN_RUN_TIMEOUT_MS = 1_000
export const MAX_RUN_TIMEOUT_MS = 24 * 60 * 60_000

const log = Log.create({ service: "loop.schema" })

export const LoopTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({
    kind: z.literal("interval"),
    everyMs: z.number().int().positive(),
  }),
])
export type LoopTrigger = z.infer<typeof LoopTriggerSchema>

/**
 * Agent a loop stage runs as when the author did not pick one. `build` is the
 * default full-capability coding agent (`src/agent/agent.ts`) — the right
 * default for a sandboxed run, which is expected to actually change code.
 */
export const DEFAULT_LOOP_AGENT = "build"

/** Persisted handle to the loop's isolated git worktree. See `worktree/sandbox.ts`. */
export const LoopWorktreeSchema = z.object({
  name: z.string().min(1),
  branch: z.string().min(1).optional(),
  directory: z.string().min(1),
})
export type LoopWorktree = z.infer<typeof LoopWorktreeSchema>

export const LoopStageSchema = z.object({
  name: z.string().min(1),
  agent: z.string().min(1),
  /** "providerID/modelID". Undefined => session default model. */
  model: z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .optional(),
  objective: z.string().min(1),
  tokenBudget: z.number().int().positive().optional(),
})
export type LoopStage = z.infer<typeof LoopStageSchema>

export const LoopDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stages: z.array(LoopStageSchema).min(1),
  trigger: LoopTriggerSchema,
  /** Temporal cap for interval loops: stop after this many runs. */
  maxRuns: z.number().int().positive().optional(),
  /** Per-run wall-clock cap in ms. Undefined => DEFAULT_RUN_TIMEOUT_MS. */
  timeoutMs: z.number().int().positive().optional(),
  /**
   * Open (or update) a GitHub PR automatically when a run completes with
   * `status: "complete"`. Best-effort: missing git/gh/auth or no diffs are
   * logged as warnings and the run still counts as complete. Default: false.
   */
  createPR: z.boolean().optional(),
  /**
   * Run every iteration in an isolated git worktree instead of the user's
   * checkout, with full-access permissions (nobody is there to answer a
   * prompt). Defaults to on — set explicitly to `false` to let the loop write
   * to the working copy. See `worktree/sandbox.ts`.
   */
  sandbox: z.boolean().optional(),
  /** The sandbox worktree created for this loop; reused across runs. */
  worktree: LoopWorktreeSchema.optional(),
  /** Persisted pause flag; survives process restarts (unlike runtime status). */
  paused: z.boolean().optional(),
  enabled: z.boolean(),
  createdAt: z.number().int().nonnegative(),
})
export type LoopDefinition = z.infer<typeof LoopDefinitionSchema>

export const LoopRunStatusEffect = Schema.Literals(["running", "complete", "error", "timeout", "cancelled", "orphaned"])
export const LoopRunStatusSchema = zod(LoopRunStatusEffect)
export type LoopRunStatus = Schema.Schema.Type<typeof LoopRunStatusEffect>

/** Compact reference to a GitHub PR created/updated by a loop run. */
export const LoopPullRequestRefSchema = z.object({
  number: z.number().int().positive(),
  url: z.string().min(1),
  branch: z.string().min(1),
  base: z.string().min(1),
  title: z.string().min(1).optional(),
  action: z.enum(["created", "updated"]),
})
export type LoopPullRequestRef = z.infer<typeof LoopPullRequestRefSchema>

export const LoopRunSchema = z.object({
  id: z.string().min(1),
  loopID: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  status: LoopRunStatusSchema,
  /** Lease heartbeat, renewed while the owning process drives the run. */
  heartbeatAt: z.number().int().nonnegative().optional(),
  sessionID: z.string().optional(),
  error: z.string().optional(),
  ok: z.boolean(),
  /** GitHub PR opened (or updated) automatically by the loop, if any. */
  pullRequest: LoopPullRequestRefSchema.optional(),
})
export type LoopRun = z.infer<typeof LoopRunSchema>

/** Reserved words that collide with the `/goal` command grammar. */
const RESERVED_OBJECTIVES = new Set(["pause", "resume", "clear", "status"])
const TOKEN_BUDGET_FLAG = /--token-budget\b/

/**
 * Sandboxing is opt-out, not opt-in: a loop drives an agent with nobody
 * watching, so the default has to be "don't touch the user's checkout".
 */
export function isSandboxed(def: Pick<LoopDefinition, "sandbox">): boolean {
  return def.sandbox !== false
}

export function isValidModel(model: string): boolean {
  const slash = model.indexOf("/")
  return slash > 0 && slash < model.length - 1
}

export function validateStage(stage: LoopStage): string | undefined {
  if (!stage.objective || !stage.objective.trim()) return "Stage objective is required"
  const objective = stage.objective.trim()
  if (RESERVED_OBJECTIVES.has(objective.toLowerCase())) {
    return `Objective cannot be the reserved word "${objective}"`
  }
  if (TOKEN_BUDGET_FLAG.test(objective)) {
    return 'Objective cannot contain "--token-budget" (use the token budget field instead)'
  }
  if (!stage.name.trim()) return "Stage name cannot be blank"
  if (!stage.agent.trim()) return "Stage agent cannot be blank"
  if (stage.model !== undefined && !isValidModel(stage.model)) {
    return 'Model must be in "providerID/modelID" form'
  }
  if (stage.tokenBudget !== undefined && (!Number.isInteger(stage.tokenBudget) || stage.tokenBudget <= 0)) {
    return "Token budget must be a positive integer"
  }
  return undefined
}

export function validateDefinition(def: LoopDefinition): string | undefined {
  for (const stage of def.stages) {
    const error = validateStage(stage)
    if (error) return error
  }
  if (def.trigger.kind === "interval" && def.trigger.everyMs < MIN_INTERVAL_MS) {
    return `Interval must be at least ${formatDuration(MIN_INTERVAL_MS)}`
  }
  if (def.trigger.kind === "interval" && def.trigger.everyMs > MAX_INTERVAL_MS) {
    return `Interval cannot exceed ${formatDuration(MAX_INTERVAL_MS)}`
  }
  if (def.maxRuns !== undefined && (!Number.isInteger(def.maxRuns) || def.maxRuns <= 0)) {
    return "Max runs must be a positive integer"
  }
  if (def.timeoutMs !== undefined) {
    if (!Number.isInteger(def.timeoutMs) || def.timeoutMs < MIN_RUN_TIMEOUT_MS) {
      return `Run timeout must be at least ${formatDuration(MIN_RUN_TIMEOUT_MS)}`
    }
    if (def.timeoutMs > MAX_RUN_TIMEOUT_MS) {
      return `Run timeout cannot exceed ${formatDuration(MAX_RUN_TIMEOUT_MS)}`
    }
  }
  return undefined
}

const DURATION_UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const

/**
 * Parse a human duration ("30s", "10m", "1h", "1h30m") into milliseconds.
 * A bare integer is interpreted as minutes. Throws on unparseable input.
 */
export function parseDuration(input: string): number {
  const text = input.trim().toLowerCase()
  if (!text) throw new Error("Duration is empty")

  if (/^\d+$/.test(text)) return Number(text) * DURATION_UNIT_MS.m

  const re = /(\d+)\s*([dhms])/g
  let total = 0
  let matched = ""
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    total += Number(m[1]) * DURATION_UNIT_MS[m[2] as keyof typeof DURATION_UNIT_MS]
    matched += m[0]
  }

  if (total <= 0 || text.replace(/\s+/g, "") !== matched.replace(/\s+/g, "")) {
    throw new Error(`Invalid duration: "${input}" (use e.g. 30s, 10m, 1h, 1h30m)`)
  }
  return total
}

/** Format milliseconds back into a compact human string ("10m", "1h 30m"). */
export function formatDuration(ms: number): string {
  if (ms < DURATION_UNIT_MS.m) return `${Math.round(ms / DURATION_UNIT_MS.s)}s`
  if (ms < DURATION_UNIT_MS.h) {
    const m = Math.floor(ms / DURATION_UNIT_MS.m)
    const s = Math.round((ms % DURATION_UNIT_MS.m) / DURATION_UNIT_MS.s)
    return s ? `${m}m ${s}s` : `${m}m`
  }
  const h = Math.floor(ms / DURATION_UNIT_MS.h)
  const m = Math.round((ms % DURATION_UNIT_MS.h) / DURATION_UNIT_MS.m)
  return m ? `${h}h ${m}m` : `${h}h`
}

function deriveName(text: string): string {
  const single = text.trim().replace(/\s+/g, " ")
  return single.length <= 48 ? single : `${single.slice(0, 47)}…`
}

export function deriveStageName(objective: string): string {
  return deriveName(objective)
}

/** Narrow unknown persisted data back to a valid definition. Drops invalid records. */
export function sanitizeDefinition(value: unknown): LoopDefinition | undefined {
  const parsed = LoopDefinitionSchema.safeParse(value)
  if (!parsed.success) {
    log.debug("discarded corrupt loop definition", {
      issues: parsed.error.issues.slice(0, 3),
    })
    return undefined
  }
  const def = parsed.data
  const err = validateDefinition(def)
  if (err) {
    log.warn("loop definition failed validation; discarding", {
      id: def.id,
      err,
    })
    return undefined
  }
  return def
}

export function sanitizeRun(value: unknown): LoopRun | undefined {
  const parsed = LoopRunSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function generateID(prefix = "loop"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// ── Templates & generation ────────────────────────────────────────────────────

export type LoopTemplate = {
  id: string
  title: string
  description: string
  draft: {
    name?: string
    stages: Array<{
      name?: string
      agent?: string
      model?: string
      objective: string
      tokenBudget?: number
    }>
    intervalMs?: number
    maxRuns?: number
  }
}

export const LOOP_TEMPLATES: LoopTemplate[] = [
  {
    id: "babysit-pr",
    title: "Babysit PR",
    description: "Watch CI on the current PR and fix failures until green",
    draft: {
      name: "babysit PR",
      stages: [
        {
          name: "watch",
          agent: "general",
          objective: "Check CI status on the current PR and report any failing checks",
        },
        {
          name: "fix",
          agent: "ralph",
          objective: "Diagnose and fix the failing CI checks until the pipeline is green",
        },
      ],
    },
  },
  {
    id: "keep-tests-green",
    title: "Keep tests green",
    description: "Run the test suite and fix failures until it passes",
    draft: {
      name: "keep tests green",
      stages: [
        {
          name: "run",
          agent: "general",
          objective: "Run the test suite and identify the failing tests",
        },
        {
          name: "fix",
          agent: "ralph",
          objective: "Fix the failing tests until the whole suite passes",
        },
      ],
    },
  },
  {
    id: "docs-sync",
    title: "Docs sync",
    description: "Find docs drifted from the code and update them",
    draft: {
      name: "docs sync",
      stages: [
        {
          name: "audit",
          agent: "general",
          objective: "Find documentation that is out of date with recent code changes",
        },
        {
          name: "update",
          agent: "build",
          objective: "Update the outdated documentation to match the current code",
        },
      ],
    },
  },
  {
    id: "nightly-qa",
    title: "Nightly QA",
    description: "Periodically review recent changes for regressions",
    draft: {
      name: "nightly QA",
      intervalMs: 60 * 60_000,
      stages: [
        {
          name: "review",
          agent: "general",
          objective: "Review the most recent changes for bugs and regressions and report findings",
        },
      ],
    },
  },
]

/** Pull the first balanced JSON object out of arbitrary model text (handles code fences/prose). */
function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) return undefined
  return text.slice(start, end + 1)
}

/** Normalize a model-authored draft into a fully-formed LoopDefinition. */
export function definitionFromGenerated(input: {
  name?: string
  stages: Array<{
    name?: string
    agent?: string
    model?: string
    objective: string
    tokenBudget?: number
  }>
  intervalMs?: number
  maxRuns?: number
}): LoopDefinition {
  if (!input.stages || input.stages.length === 0) {
    throw new Error("Generated pipeline has no stages")
  }
  const stages: LoopStage[] = input.stages.map((s) => {
    const objective = s.objective?.trim()
    if (!objective) throw new Error("Every stage needs an objective")
    const stage: LoopStage = {
      name: s.name?.trim() || deriveStageName(objective),
      agent: s.agent?.trim() || DEFAULT_LOOP_AGENT,
      objective,
    }
    if (s.model && isValidModel(s.model)) stage.model = s.model
    if (s.tokenBudget && s.tokenBudget > 0) stage.tokenBudget = Math.floor(s.tokenBudget)
    return stage
  })
  const def: LoopDefinition = {
    id: generateID(),
    name: input.name?.trim() || stages[0].name,
    stages,
    trigger: input.intervalMs === undefined ? { kind: "manual" } : { kind: "interval", everyMs: input.intervalMs },
    enabled: true,
    createdAt: Date.now(),
  }
  if (input.maxRuns && input.maxRuns > 0) def.maxRuns = Math.floor(input.maxRuns)
  const error = validateDefinition(def)
  if (error) throw new Error(error)
  return def
}

/**
 * Parse a model-generated pipeline description into a validated LoopDefinition.
 * Expects a JSON object `{ name?, stages: [...], intervalMs?, maxRuns? }`,
 * optionally wrapped in prose/code fences. Throws with a clear message on failure.
 */
export function definitionFromGeneratedText(text: string): LoopDefinition {
  const json = extractJsonObject(text)
  if (!json) throw new Error("The model did not return a JSON pipeline")
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error("The model's response was not valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Generated pipeline is not an object")
  const v = parsed as Record<string, unknown>
  const rawStages = Array.isArray(v.stages) ? v.stages : []
  const stages = rawStages
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({
      objective: typeof s.objective === "string" ? s.objective : "",
      ...(typeof s.name === "string" && s.name.trim() ? { name: s.name } : {}),
      ...(typeof s.agent === "string" && s.agent.trim() ? { agent: s.agent } : {}),
      ...(typeof s.model === "string" && isValidModel(s.model) ? { model: s.model } : {}),
      ...(typeof s.tokenBudget === "number" ? { tokenBudget: s.tokenBudget } : {}),
    }))
  return definitionFromGenerated({
    stages,
    ...(typeof v.name === "string" && v.name.trim() ? { name: v.name } : {}),
    ...(typeof v.intervalMs === "number" ? { intervalMs: v.intervalMs } : {}),
    ...(typeof v.maxRuns === "number" ? { maxRuns: v.maxRuns } : {}),
  })
}
