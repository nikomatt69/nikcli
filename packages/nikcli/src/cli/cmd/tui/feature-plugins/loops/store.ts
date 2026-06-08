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
export const LOOPS_HISTORY_KV_KEY = "loops:history"

/** How many recent runs to retain per loop. */
export const HISTORY_LIMIT = 20

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
  /** Model in "providerID/modelID" form. Unset => the session's default model. */
  model?: string
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
  /** "providerID/modelID"; undefined => session default model. */
  model?: string
  /** undefined => manual trigger. */
  intervalMs?: number
  tokenBudget?: number
  maxRuns?: number
}

/** A model reference is valid when it has the "providerID/modelID" shape. */
export function isValidModel(model: string): boolean {
  const slash = model.indexOf("/")
  return slash > 0 && slash < model.length - 1
}

export const DEFAULT_AGENT = "ralph"

/**
 * Words the `/goal` command treats as subcommands, and the budget flag it parses
 * out of its arguments. An objective equal to a subcommand — or containing the
 * budget flag — would be misparsed by the goal grammar, so we reject it up front
 * with a clear message instead of letting a run fail cryptically later.
 */
const RESERVED_OBJECTIVES = new Set(["pause", "resume", "clear", "status"])
const TOKEN_BUDGET_FLAG = /--token-budget\b/

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
  const objective = draft.objective.trim()
  if (RESERVED_OBJECTIVES.has(objective.toLowerCase())) {
    return `Objective cannot be the reserved word "${objective}"`
  }
  if (TOKEN_BUDGET_FLAG.test(objective)) {
    return 'Objective cannot contain "--token-budget" (use the token budget field instead)'
  }
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
  if (draft.model !== undefined && !isValidModel(draft.model)) {
    return 'Model must be in "providerID/modelID" form'
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
    ...(draft.model ? { model: draft.model } : {}),
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
    ...(typeof v.model === "string" && isValidModel(v.model) ? { model: v.model } : {}),
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

// ── Run history ──────────────────────────────────────────────────────────────

/** One recorded execution of a loop. Diff totals are the session's cumulative diff at run end. */
export type LoopRun = {
  startedAt: number
  endedAt: number
  ok: boolean
  error?: string
  additions: number
  deletions: number
  files: number
}

type HistoryMap = Record<string, LoopRun[]>

function sanitizeRun(value: unknown): LoopRun | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.startedAt !== "number" || typeof v.endedAt !== "number" || typeof v.ok !== "boolean") return undefined
  return {
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    ok: v.ok,
    ...(typeof v.error === "string" ? { error: v.error } : {}),
    additions: typeof v.additions === "number" ? v.additions : 0,
    deletions: typeof v.deletions === "number" ? v.deletions : 0,
    files: typeof v.files === "number" ? v.files : 0,
  }
}

function loadHistoryMap(kv: KvLike): HistoryMap {
  const raw = kv.get<unknown>(LOOPS_HISTORY_KV_KEY, {})
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
  const out: HistoryMap = {}
  for (const [id, runs] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(runs)) continue
    out[id] = runs.map(sanitizeRun).filter((r): r is LoopRun => r !== undefined)
  }
  return out
}

/** Most-recent-first run history for a loop. */
export function loadHistory(kv: KvLike, id: string): LoopRun[] {
  return [...(loadHistoryMap(kv)[id] ?? [])].sort((a, b) => b.endedAt - a.endedAt)
}

/** Append a run, trimming to HISTORY_LIMIT (oldest dropped). */
export function recordRun(kv: KvLike, id: string, run: LoopRun): void {
  const map = loadHistoryMap(kv)
  const list = [...(map[id] ?? []), run]
  map[id] = list.slice(-HISTORY_LIMIT)
  kv.set(LOOPS_HISTORY_KV_KEY, map)
}

export function clearHistory(kv: KvLike, id: string): void {
  const map = loadHistoryMap(kv)
  if (id in map) {
    delete map[id]
    kv.set(LOOPS_HISTORY_KV_KEY, map)
  }
}

export type LoopStats = { total: number; ok: number; successRate: number; additions: number; deletions: number }

/** Aggregate stats over a loop's recorded runs. successRate is 0..1 (0 when no runs). */
export function loopStats(runs: LoopRun[]): LoopStats {
  const total = runs.length
  const ok = runs.filter((r) => r.ok).length
  const additions = runs.reduce((sum, r) => sum + r.additions, 0)
  const deletions = runs.reduce((sum, r) => sum + r.deletions, 0)
  return { total, ok, successRate: total === 0 ? 0 : ok / total, additions, deletions }
}
