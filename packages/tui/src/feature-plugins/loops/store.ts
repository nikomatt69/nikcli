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

/**
 * One step of a loop's pipeline. Each stage drives the Goal system with its own
 * agent/model/objective; stages run sequentially in the same session so context
 * flows from one to the next (e.g. explore → plan → implement → review).
 */
export type LoopStage = {
  name: string
  agent: string
  /** Model in "providerID/modelID" form. Unset => the session's default model. */
  model?: string
  objective: string
  tokenBudget?: number
}

export type LoopDefinition = {
  id: string
  name: string
  stages: LoopStage[]
  trigger: LoopTrigger
  /** Temporal cap for interval loops: stop after this many runs (undefined = unlimited). */
  maxRuns?: number
  /**
   * Open (or update) a GitHub PR automatically when a run completes with
   * `status: "complete"`. Best-effort: missing git/gh/auth or no diffs are
   * logged as warnings and the run still counts as complete. Default: false.
   */
  createPR?: boolean
  enabled: boolean
  createdAt: number
}

/** Minimal persistence surface — satisfied by the TUI `api.kv`. */
export type KvLike = {
  get: <T = unknown>(key: string, fallback?: T) => T
  set: (key: string, value: unknown) => void
}

/** Draft for a single stage (fields optional while being collected in the UI). */
export type StageDraft = {
  name?: string
  agent?: string
  /** "providerID/modelID"; undefined => session default model. */
  model?: string
  objective: string
  tokenBudget?: number
}

export type LoopDraft = {
  name?: string
  stages: StageDraft[]
  /** undefined => manual trigger. */
  intervalMs?: number
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

/** Validate a single stage. Returns a human error message, or undefined when valid. */
export function validateStage(stage: StageDraft): string | undefined {
  if (!stage.objective || !stage.objective.trim()) return "Stage objective is required"
  const objective = stage.objective.trim()
  if (RESERVED_OBJECTIVES.has(objective.toLowerCase())) {
    return `Objective cannot be the reserved word "${objective}"`
  }
  if (TOKEN_BUDGET_FLAG.test(objective)) {
    return 'Objective cannot contain "--token-budget" (use the token budget field instead)'
  }
  if (stage.name !== undefined && !stage.name.trim()) return "Stage name cannot be blank"
  if (stage.agent !== undefined && !stage.agent.trim()) return "Stage agent cannot be blank"
  if (stage.model !== undefined && !isValidModel(stage.model)) {
    return 'Model must be in "providerID/modelID" form'
  }
  if (stage.tokenBudget !== undefined && (!Number.isInteger(stage.tokenBudget) || stage.tokenBudget <= 0)) {
    return "Token budget must be a positive integer"
  }
  return undefined
}

/** Validate a whole loop draft (stages + loop-level fields). */
export function validateDraft(draft: LoopDraft): string | undefined {
  if (!draft.stages || draft.stages.length === 0) return "A loop needs at least one stage"
  for (const stage of draft.stages) {
    const error = validateStage(stage)
    if (error) return error
  }
  if (draft.name !== undefined && !draft.name.trim()) return "Name cannot be blank"
  if (draft.intervalMs !== undefined) {
    if (!Number.isFinite(draft.intervalMs)) return "Interval is not a valid duration"
    if (draft.intervalMs < MIN_INTERVAL_MS) return `Interval must be at least ${formatDuration(MIN_INTERVAL_MS)}`
  }
  if (draft.maxRuns !== undefined && (!Number.isInteger(draft.maxRuns) || draft.maxRuns <= 0)) {
    return "Max runs must be a positive integer"
  }
  return undefined
}

export function generateId(): string {
  return `loop_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function deriveName(text: string): string {
  const single = text.trim().replace(/\s+/g, " ")
  return single.length <= 48 ? single : `${single.slice(0, 47)}…`
}

/** Build a fully-formed stage from a (validated) draft, applying defaults. */
export function stageFromDraft(draft: StageDraft): LoopStage {
  return {
    name: draft.name?.trim() || deriveName(draft.objective),
    agent: draft.agent?.trim() || DEFAULT_AGENT,
    ...(draft.model ? { model: draft.model } : {}),
    objective: draft.objective.trim(),
    ...(draft.tokenBudget !== undefined ? { tokenBudget: draft.tokenBudget } : {}),
  }
}

/** Build a fully-formed definition from a validated draft. */
export function createDefinition(draft: LoopDraft): LoopDefinition {
  const error = validateDraft(draft)
  if (error) throw new Error(error)
  const stages = draft.stages.map(stageFromDraft)
  return {
    id: generateId(),
    name: draft.name?.trim() || stages[0].name,
    stages,
    trigger: draft.intervalMs === undefined ? { kind: "manual" } : { kind: "interval", everyMs: draft.intervalMs },
    ...(draft.maxRuns !== undefined ? { maxRuns: draft.maxRuns } : {}),
    enabled: true,
    createdAt: Date.now(),
  }
}

// ── Templates & generation ────────────────────────────────────────────────────

/** A starter pipeline the user can instantiate from the wizard. */
export type LoopTemplate = {
  id: string
  title: string
  description: string
  draft: LoopDraft
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

/**
 * Parse a model-generated pipeline description into a validated LoopDraft.
 * Expects a JSON object `{ name?, stages: [{ name?, agent?, model?, objective, tokenBudget? }] }`,
 * optionally wrapped in prose/code fences. Throws with a clear message on failure.
 */
export function parseGeneratedDraft(text: string): LoopDraft {
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
  const stages: StageDraft[] = rawStages
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({
      objective: typeof s.objective === "string" ? s.objective : "",
      ...(typeof s.name === "string" && s.name.trim() ? { name: s.name } : {}),
      ...(typeof s.agent === "string" && s.agent.trim() ? { agent: s.agent } : {}),
      ...(typeof s.model === "string" && isValidModel(s.model) ? { model: s.model } : {}),
      ...(typeof s.tokenBudget === "number" ? { tokenBudget: s.tokenBudget } : {}),
    }))
  const draft: LoopDraft = {
    stages,
    ...(typeof v.name === "string" && v.name.trim() ? { name: v.name } : {}),
  }
  const error = validateDraft(draft)
  if (error) throw new Error(error)
  return draft
}

/** Narrow one persisted stage, or undefined if it lacks an objective. */
function sanitizeStage(value: unknown): LoopStage | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.objective !== "string" || !v.objective.trim()) return undefined
  return {
    name: typeof v.name === "string" && v.name.trim() ? v.name : deriveName(v.objective),
    agent: typeof v.agent === "string" && v.agent.trim() ? v.agent : DEFAULT_AGENT,
    ...(typeof v.model === "string" && isValidModel(v.model) ? { model: v.model } : {}),
    objective: v.objective,
    ...(typeof v.tokenBudget === "number" && v.tokenBudget > 0 ? { tokenBudget: v.tokenBudget } : {}),
  }
}

/**
 * Narrow unknown persisted data back to a valid definition, or undefined if
 * corrupt. Migrates legacy single-objective loops into a one-stage pipeline.
 */
function sanitize(value: unknown): LoopDefinition | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string") return undefined

  let stages: LoopStage[]
  if (Array.isArray(v.stages)) {
    stages = v.stages.map(sanitizeStage).filter((s): s is LoopStage => s !== undefined)
  } else {
    // Legacy migration: a single top-level objective becomes one stage.
    const legacy = sanitizeStage({
      objective: v.objective,
      agent: v.agent,
      model: v.model,
      tokenBudget: v.tokenBudget,
    })
    stages = legacy ? [legacy] : []
  }
  if (stages.length === 0) return undefined

  const trigger = v.trigger as Record<string, unknown> | undefined
  const normalizedTrigger: LoopTrigger =
    trigger?.kind === "interval" && typeof trigger.everyMs === "number" && trigger.everyMs >= MIN_INTERVAL_MS
      ? { kind: "interval", everyMs: trigger.everyMs }
      : { kind: "manual" }
  return {
    id: v.id,
    name: typeof v.name === "string" && v.name.trim() ? v.name : stages[0].name,
    stages,
    trigger: normalizedTrigger,
    ...(typeof v.maxRuns === "number" && v.maxRuns > 0 ? { maxRuns: v.maxRuns } : {}),
    ...(v.createPR === true ? { createPR: true } : {}),
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
  // Single load+save instead of getById (load) + upsert (load again).
  const list = loadAll(kv)
  const idx = list.findIndex((d) => d.id === id)
  if (idx === -1) return undefined
  const next = { ...list[idx], enabled }
  list[idx] = next
  saveAll(kv, list)
  return next
}

// ── Run history ──────────────────────────────────────────────────────────────

/** Per-stage outcome within a run. Diff totals are this stage's own contribution. */
export type LoopStageResult = {
  name: string
  ok: boolean
  error?: string
  additions: number
  deletions: number
  files: number
}

/** Compact reference to a GitHub PR auto-created by a loop run. */
export type LoopRunPullRequest = {
  number: number
  url: string
  branch: string
  base: string
  title?: string
  action: "created" | "updated"
}

/** One recorded execution of a loop. Diff totals are the run's own contribution (delta). */
export type LoopRun = {
  startedAt: number
  endedAt: number
  ok: boolean
  error?: string
  additions: number
  deletions: number
  files: number
  /** Session the run executed in, for opening it from the history. */
  sessionID?: string
  /** Per-stage breakdown (omitted for legacy single-stage runs). */
  stages?: LoopStageResult[]
  /** GitHub PR auto-opened/updated by the loop on completion, if any. */
  pullRequest?: LoopRunPullRequest
}

type HistoryMap = Record<string, LoopRun[]>

function sanitizeStageResult(value: unknown): LoopStageResult | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.name !== "string" || typeof v.ok !== "boolean") {
    return undefined
  }
  return {
    name: v.name,
    ok: v.ok,
    ...(typeof v.error === "string" ? { error: v.error } : {}),
    additions: typeof v.additions === "number" ? v.additions : 0,
    deletions: typeof v.deletions === "number" ? v.deletions : 0,
    files: typeof v.files === "number" ? v.files : 0,
  }
}

function sanitizeRun(value: unknown): LoopRun | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.startedAt !== "number" || typeof v.endedAt !== "number" || typeof v.ok !== "boolean") return undefined
  const stages = Array.isArray(v.stages)
    ? v.stages.map(sanitizeStageResult).filter((s): s is LoopStageResult => s !== undefined)
    : undefined
  return {
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    ok: v.ok,
    ...(typeof v.error === "string" ? { error: v.error } : {}),
    additions: typeof v.additions === "number" ? v.additions : 0,
    deletions: typeof v.deletions === "number" ? v.deletions : 0,
    files: typeof v.files === "number" ? v.files : 0,
    ...(typeof v.sessionID === "string" ? { sessionID: v.sessionID } : {}),
    ...(stages && stages.length > 0 ? { stages } : {}),
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

/** Per-file cumulative diff counts for a session, keyed by file path. */
export type DiffSnapshot = Record<string, { additions: number; deletions: number }>

/**
 * Compute a run's own contribution as the delta between two cumulative session
 * snapshots. Per-file so a file edited across runs is not double-counted; only
 * the increase since `before` is attributed to this run.
 */
export function diffDelta(
  before: DiffSnapshot,
  after: DiffSnapshot,
): { additions: number; deletions: number; files: number } {
  let additions = 0
  let deletions = 0
  let files = 0
  for (const [file, a] of Object.entries(after)) {
    const b = before[file] ?? { additions: 0, deletions: 0 }
    const da = Math.max(0, a.additions - b.additions)
    const dd = Math.max(0, a.deletions - b.deletions)
    additions += da
    deletions += dd
    if (da > 0 || dd > 0) files += 1
  }
  return { additions, deletions, files }
}

export type LoopStats = {
  total: number
  ok: number
  successRate: number
  additions: number
  deletions: number
}

/** Aggregate stats over a loop's recorded runs. successRate is 0..1 (0 when no runs). */
export function loopStats(runs: LoopRun[]): LoopStats {
  const total = runs.length
  const ok = runs.filter((r) => r.ok).length
  const additions = runs.reduce((sum, r) => sum + r.additions, 0)
  const deletions = runs.reduce((sum, r) => sum + r.deletions, 0)
  return {
    total,
    ok,
    successRate: total === 0 ? 0 : ok / total,
    additions,
    deletions,
  }
}
