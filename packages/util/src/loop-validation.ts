/**
 * What makes a loop definition valid, and the messages a user sees when it is not.
 *
 * The rules are shared: the server rejects a bad definition, and the terminal checks the same
 * things before posting one so the error appears next to the field rather than after a round
 * trip. Keeping them in one place is what stops the two from disagreeing.
 *
 * Typed structurally rather than against `loop/schema.ts`'s zod output — these functions read a
 * handful of fields, and naming the full domain type would drag a server module into the
 * terminal for a string comparison. `loop/schema.ts` re-exports all of it.
 */

export const DEFAULT_LOOP_AGENT = "build"

export const MIN_INTERVAL_MS = 30_000
/** A month. Longer than this and a "loop" is really a reminder. */
export const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
export const MIN_RUN_TIMEOUT_MS = 1_000
export const MAX_RUN_TIMEOUT_MS = 24 * 60 * 60_000

const RESERVED_OBJECTIVES = new Set(["pause", "resume", "clear", "status"])
const TOKEN_BUDGET_FLAG = /--token-budget\b/

/** The fields validation reads off a stage. */
export type ValidatableStage = {
  name: string
  agent: string
  objective: string
  model?: string | undefined
  tokenBudget?: number | undefined
}

/** The fields validation reads off a definition. */
export type ValidatableDefinition = {
  stages: readonly ValidatableStage[]
  trigger: { readonly kind: string; readonly everyMs?: number | undefined }
  maxRuns?: number | undefined
  timeoutMs?: number | undefined
}

/** A model-authored pipeline, before it becomes a definition. */
export type GeneratedLoopDraft = {
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

export function isValidModel(model: string): boolean {
  const slash = model.indexOf("/")
  return slash > 0 && slash < model.length - 1
}

export function validateStage(stage: ValidatableStage): string | undefined {
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

export function validateDefinition(def: ValidatableDefinition): string | undefined {
  for (const stage of def.stages) {
    const error = validateStage(stage)
    if (error) return error
  }
  const everyMs = def.trigger.kind === "interval" ? def.trigger.everyMs : undefined
  if (everyMs !== undefined && everyMs < MIN_INTERVAL_MS) {
    return `Interval must be at least ${formatDuration(MIN_INTERVAL_MS)}`
  }
  if (everyMs !== undefined && everyMs > MAX_INTERVAL_MS) {
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
