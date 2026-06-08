/**
 * Loops — persisted definitions and pure helpers.
 *
 * A "loop" binds an objective to a trigger. Recurring (interval) loops fire on a
 * timer; each run drives the existing Goal system (`/goal <objective>`), which
 * iterates autonomously until the agent declares the goal complete/blocked or
 * the goal's own iteration/budget caps are hit.
 *
 * This module is intentionally free of any OpenTUI/Solid imports so it can be
 * unit-tested in isolation. Reactive concerns live in `runner.ts`.
 */

export const LOOPS_KV_KEY = "loops"

/** Lower bound for interval triggers — guards against accidental hot loops. */
export const MIN_INTERVAL_MS = 30_000

/** Global ceiling on simultaneously-running loops (back-pressure safety). */
export const MAX_CONCURRENT_RUNS = 3

export type LoopTrigger = { kind: "manual" } | { kind: "interval"; everyMs: number }

export type LoopDefinition = {
  id: string
  name: string
  objective: string
  agent: string
  trigger: LoopTrigger
  tokenBudget?: number
  /** Temporal cap for interval loops: stop after this many runs (undefined = unlimited). */
  maxRuns?: number
  enabled: boolean
  createdAt: number
}

/** Minimal persistence surface — satisfied by the TUI `api.kv`. */
export type KvLike = {
  get: <T = unknown>(key: string, fallback?: T) => T
  set: (key: string, value: unknown) => void
}

export type LoopDraft = {
  name?: string
  objective: string
  agent?: string
  /** undefined => manual trigger. */
  intervalMs?: number
  tokenBudget?: number
  maxRuns?: number
}

export const DEFAULT_AGENT = "ralph"

const DURATION_UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const

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

/** Validate a draft. Returns a human error message, or undefined when valid. */
export function validateDraft(draft: LoopDraft): string | undefined {
  if (!draft.objective || !draft.objective.trim()) return "Objective is required"
  if (draft.name !== undefined && !draft.name.trim()) return "Name cannot be blank"
  if (draft.intervalMs !== undefined) {
    if (!Number.isFinite(draft.intervalMs)) return "Interval is not a valid duration"
    if (draft.intervalMs < MIN_INTERVAL_MS) return `Interval must be at least ${formatDuration(MIN_INTERVAL_MS)}`
  }
  if (draft.tokenBudget !== undefined && (!Number.isInteger(draft.tokenBudget) || draft.tokenBudget <= 0)) {
    return "Token budget must be a positive integer"
  }
  if (draft.maxRuns !== undefined && (!Number.isInteger(draft.maxRuns) || draft.maxRuns <= 0)) {
    return "Max runs must be a positive integer"
  }
  return undefined
}

export function generateId(): string {
  return `loop_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function deriveName(objective: string): string {
  const single = objective.trim().replace(/\s+/g, " ")
  return single.length <= 48 ? single : `${single.slice(0, 47)}…`
}

/** Build a fully-formed definition from a validated draft. */
export function createDefinition(draft: LoopDraft): LoopDefinition {
  const error = validateDraft(draft)
  if (error) throw new Error(error)
  return {
    id: generateId(),
    name: draft.name?.trim() || deriveName(draft.objective),
    objective: draft.objective.trim(),
    agent: draft.agent?.trim() || DEFAULT_AGENT,
    trigger: draft.intervalMs === undefined ? { kind: "manual" } : { kind: "interval", everyMs: draft.intervalMs },
    ...(draft.tokenBudget !== undefined ? { tokenBudget: draft.tokenBudget } : {}),
    ...(draft.maxRuns !== undefined ? { maxRuns: draft.maxRuns } : {}),
    enabled: true,
    createdAt: Date.now(),
  }
}

/** Narrow unknown persisted data back to a valid definition, or undefined if corrupt. */
function sanitize(value: unknown): LoopDefinition | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string" || typeof v.objective !== "string") return undefined
  const trigger = v.trigger as Record<string, unknown> | undefined
  const normalizedTrigger: LoopTrigger =
    trigger?.kind === "interval" && typeof trigger.everyMs === "number" && trigger.everyMs >= MIN_INTERVAL_MS
      ? { kind: "interval", everyMs: trigger.everyMs }
      : { kind: "manual" }
  return {
    id: v.id,
    name: typeof v.name === "string" && v.name.trim() ? v.name : deriveName(v.objective),
    objective: v.objective,
    agent: typeof v.agent === "string" && v.agent.trim() ? v.agent : DEFAULT_AGENT,
    trigger: normalizedTrigger,
    ...(typeof v.tokenBudget === "number" && v.tokenBudget > 0 ? { tokenBudget: v.tokenBudget } : {}),
    ...(typeof v.maxRuns === "number" && v.maxRuns > 0 ? { maxRuns: v.maxRuns } : {}),
    enabled: v.enabled !== false,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
  }
}

export function loadAll(kv: KvLike): LoopDefinition[] {
  const raw = kv.get<unknown>(LOOPS_KV_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw.map(sanitize).filter((x): x is LoopDefinition => x !== undefined)
}

export function saveAll(kv: KvLike, list: LoopDefinition[]): void {
  kv.set(LOOPS_KV_KEY, list)
}

export function getById(kv: KvLike, id: string): LoopDefinition | undefined {
  return loadAll(kv).find((d) => d.id === id)
}

export function upsert(kv: KvLike, def: LoopDefinition): void {
  const list = loadAll(kv)
  const idx = list.findIndex((d) => d.id === def.id)
  if (idx === -1) list.push(def)
  else list[idx] = def
  saveAll(kv, list)
}

export function removeById(kv: KvLike, id: string): void {
  saveAll(
    kv,
    loadAll(kv).filter((d) => d.id !== id),
  )
}

export function setEnabled(kv: KvLike, id: string, enabled: boolean): LoopDefinition | undefined {
  const def = getById(kv, id)
  if (!def) return undefined
  const next = { ...def, enabled }
  upsert(kv, next)
  return next
}
