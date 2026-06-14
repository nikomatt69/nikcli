/**
 * Missions — TUI plugin: persistence layer (KV cache + run history).
 *
 * Mirrors `feature-plugins/loops/store.ts`: a fast in-TUI cache of the
 * server's persisted state so the sidebar feels snappy, plus per-mission
 * execution history for the manager dialog. The server (in `src/mission/`) is
 * the source of truth; this module only mirrors the shape we care about.
 */

export const MISSIONS_KV_KEY = "missions"
export const MISSIONS_HISTORY_KV_KEY = "missions:history"

/** How many recent executions to retain per mission. */
export const HISTORY_LIMIT = 50

export type FeatureStatus = "pending" | "running" | "done" | "blocked" | "skipped" | "error"
export type MilestoneStatus = "pending" | "running" | "validating" | "done" | "blocked"
export type ValidationPolicy = "scrutiny" | "user-test" | "none"
export type MissionStatus = "planning" | "ready" | "running" | "paused" | "frozen" | "complete" | "error"

export type MissionFeature = {
  id: string
  name: string
  objective: string
  agent: string
  /** "providerID/modelID" */
  model?: string
  tokenBudget?: number
  /** Sibling feature ids that must reach `done` first. */
  dependsOn: string[]
  status: FeatureStatus
  error?: string
}

export type MissionMilestone = {
  id: string
  name: string
  features: MissionFeature[]
  validation: ValidationPolicy
  status: MilestoneStatus
}

export type MissionModels = {
  worker?: string
  validation?: string
  orchestrator?: string
}

export type MissionDefinition = {
  id: string
  name: string
  brief: string
  milestones: MissionMilestone[]
  models: MissionModels
  timeoutMs?: number
  status: MissionStatus
  createdAt: number
}

/** Minimal persistence surface — satisfied by the TUI `api.kv`. */
export type KvLike = {
  get: <T = unknown>(key: string, fallback?: T) => T
  set: (key: string, value: unknown) => void
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const FEATURE_STATUSES: ReadonlySet<FeatureStatus> = new Set([
  "pending",
  "running",
  "done",
  "blocked",
  "skipped",
  "error",
])
const MILESTONE_STATUSES: ReadonlySet<MilestoneStatus> = new Set([
  "pending",
  "running",
  "validating",
  "done",
  "blocked",
])
const VALIDATION_POLICIES: ReadonlySet<ValidationPolicy> = new Set(["scrutiny", "user-test", "none"])
const MISSION_STATUSES: ReadonlySet<MissionStatus> = new Set([
  "planning",
  "ready",
  "running",
  "paused",
  "frozen",
  "complete",
  "error",
])

function sanitizeFeature(value: unknown): MissionFeature | undefined {
  if (!isPlainObject(value)) return undefined
  const objective = asString(value.objective)
  if (!objective.trim()) return undefined
  const id = asString(value.id) || deriveFeatureId(value)
  const name = asString(value.name).trim() || deriveName(objective)
  const agent = asString(value.agent).trim() || "ralph"
  const statusRaw = asString(value.status, "pending")
  const status: FeatureStatus = FEATURE_STATUSES.has(statusRaw as FeatureStatus)
    ? (statusRaw as FeatureStatus)
    : "pending"
  const model = asString(value.model) || undefined
  const dependsOn = Array.isArray(value.dependsOn)
    ? value.dependsOn.filter((d): d is string => typeof d === "string")
    : []
  const f: MissionFeature = {
    id,
    name,
    objective,
    agent,
    status,
    dependsOn,
    ...(model ? { model } : {}),
    ...(asNumber(value.tokenBudget) ? { tokenBudget: Math.floor(asNumber(value.tokenBudget)!) } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  }
  return f
}

function deriveFeatureId(value: Record<string, unknown>): string {
  // Stable hash of the objective so the same feature keeps its id across syncs.
  const objective = asString(value.objective)
  let h = 0
  for (let i = 0; i < objective.length; i++) h = (h * 31 + objective.charCodeAt(i)) | 0
  return `f_${(h >>> 0).toString(36)}`
}

function deriveName(text: string): string {
  const single = text.trim().replace(/\s+/g, " ")
  return single.length <= 48 ? single : `${single.slice(0, 47)}…`
}

function sanitizeMilestone(value: unknown): MissionMilestone | undefined {
  if (!isPlainObject(value)) return undefined
  const features = Array.isArray(value.features) ? value.features.map(sanitizeFeature) : []
  const valid = features.filter((f): f is MissionFeature => f !== undefined)
  if (valid.length === 0) return undefined
  const id = asString(value.id) || `m_${Math.random().toString(36).slice(2, 8)}`
  const name = asString(value.name).trim() || "Milestone"
  const validationRaw = asString(value.validation, "scrutiny")
  const validation: ValidationPolicy = VALIDATION_POLICIES.has(validationRaw as ValidationPolicy)
    ? (validationRaw as ValidationPolicy)
    : "scrutiny"
  const statusRaw = asString(value.status, "pending")
  const status: MilestoneStatus = MILESTONE_STATUSES.has(statusRaw as MilestoneStatus)
    ? (statusRaw as MilestoneStatus)
    : "pending"
  return { id, name, features: valid, validation, status }
}

function sanitizeModels(value: unknown): MissionModels {
  if (!isPlainObject(value)) return {}
  const out: MissionModels = {}
  if (typeof value.worker === "string") out.worker = value.worker
  if (typeof value.validation === "string") out.validation = value.validation
  if (typeof value.orchestrator === "string") out.orchestrator = value.orchestrator
  return out
}

function sanitizeDefinition(value: unknown): MissionDefinition | undefined {
  if (!isPlainObject(value)) return undefined
  const id = asString(value.id)
  const name = asString(value.name)
  const brief = asString(value.brief)
  if (!id || !name || !brief.trim()) return undefined
  const milestonesRaw = Array.isArray(value.milestones) ? value.milestones : []
  const milestones = milestonesRaw.map(sanitizeMilestone).filter((m): m is MissionMilestone => m !== undefined)
  if (milestones.length === 0) return undefined
  const statusRaw = asString(value.status, "ready")
  const status: MissionStatus = MISSION_STATUSES.has(statusRaw as MissionStatus)
    ? (statusRaw as MissionStatus)
    : "ready"
  const timeoutMs = asNumber(value.timeoutMs)
  return {
    id,
    name,
    brief,
    milestones,
    models: sanitizeModels(value.models),
    ...(timeoutMs && timeoutMs > 0 ? { timeoutMs: Math.floor(timeoutMs) } : {}),
    status,
    createdAt: asNumber(value.createdAt) ?? Date.now(),
  }
}

export function loadAll(kv: KvLike): MissionDefinition[] {
  const raw = kv.get<unknown>(MISSIONS_KV_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeDefinition).filter((m): m is MissionDefinition => m !== undefined)
}

function saveAll(kv: KvLike, list: MissionDefinition[]): void {
  kv.set(MISSIONS_KV_KEY, list)
}

export function getById(kv: KvLike, id: string): MissionDefinition | undefined {
  return loadAll(kv).find((m) => m.id === id)
}

export function upsert(kv: KvLike, def: MissionDefinition): void {
  const list = loadAll(kv)
  const idx = list.findIndex((m) => m.id === def.id)
  if (idx === -1) list.push(def)
  else list[idx] = def
  saveAll(kv, list)
}

export function removeById(kv: KvLike, id: string): void {
  saveAll(
    kv,
    loadAll(kv).filter((m) => m.id !== id),
  )
}

// ── Execution history ───────────────────────────────────────────────────────

export type MissionExec = {
  execID: string
  kind: "feature" | "validation"
  targetID: string
  targetName: string
  startedAt: number
  endedAt?: number
  status: "running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
  ok: boolean
  error?: string
  sessionID?: string
}

type HistoryMap = Record<string, MissionExec[]>

function sanitizeExec(value: unknown): MissionExec | undefined {
  if (!isPlainObject(value)) return undefined
  const id = asString(value.id)
  if (!id) return undefined
  const kindRaw = asString(value.kind)
  if (kindRaw !== "feature" && kindRaw !== "validation") return undefined
  const startedAt = asNumber(value.startedAt)
  if (!startedAt) return undefined
  const statusRaw = asString(value.status, "running")
  return {
    execID: id,
    kind: kindRaw,
    targetID: asString(value.targetID),
    targetName: asString(value.targetName),
    startedAt,
    ...(asNumber(value.endedAt) !== undefined ? { endedAt: asNumber(value.endedAt)! } : {}),
    status: statusRaw as MissionExec["status"],
    ok: value.ok === true,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.sessionID === "string" ? { sessionID: value.sessionID } : {}),
  }
}

function loadHistoryMap(kv: KvLike): HistoryMap {
  const raw = kv.get<unknown>(MISSIONS_HISTORY_KV_KEY, {})
  if (!isPlainObject(raw)) return {}
  const out: HistoryMap = {}
  for (const [id, runs] of Object.entries(raw)) {
    if (!Array.isArray(runs)) continue
    out[id] = runs.map(sanitizeExec).filter((r): r is MissionExec => r !== undefined)
  }
  return out
}

export function loadHistory(kv: KvLike, id: string): MissionExec[] {
  return [...(loadHistoryMap(kv)[id] ?? [])].sort((a, b) => b.startedAt - a.startedAt)
}

export function recordExec(kv: KvLike, id: string, exec: MissionExec): void {
  const map = loadHistoryMap(kv)
  const list = [...(map[id] ?? []), exec]
  map[id] = list.slice(-HISTORY_LIMIT)
  kv.set(MISSIONS_HISTORY_KV_KEY, map)
}

export function updateExec(kv: KvLike, id: string, execID: string, patch: Partial<MissionExec>): void {
  const map = loadHistoryMap(kv)
  const list = map[id] ?? []
  const idx = list.findIndex((e) => e.execID === execID)
  if (idx === -1) return
  list[idx] = { ...list[idx], ...patch }
  map[id] = list
  kv.set(MISSIONS_HISTORY_KV_KEY, map)
}

export function clearHistory(kv: KvLike, id: string): void {
  const map = loadHistoryMap(kv)
  if (id in map) {
    delete map[id]
    kv.set(MISSIONS_HISTORY_KV_KEY, map)
  }
}

// ── Progress & stats ────────────────────────────────────────────────────────

export type MissionProgress = {
  totalFeatures: number
  doneFeatures: number
  runningFeatures: number
  totalMilestones: number
  doneMilestones: number
  runningMilestoneID?: string
}

export function progressOf(def: MissionDefinition): MissionProgress {
  let totalFeatures = 0
  let doneFeatures = 0
  let runningFeatures = 0
  let runningMilestoneID: string | undefined
  let doneMilestones = 0
  for (const m of def.milestones) {
    if (m.status === "done") doneMilestones++
    if (m.status === "running" || m.status === "validating") runningMilestoneID = m.id
    for (const f of m.features) {
      totalFeatures++
      if (f.status === "done" || f.status === "skipped") doneFeatures++
      if (f.status === "running") runningFeatures++
    }
  }
  return {
    totalFeatures,
    doneFeatures,
    runningFeatures,
    totalMilestones: def.milestones.length,
    doneMilestones,
    runningMilestoneID,
  }
}

export type MissionStats = {
  total: number
  ok: number
  successRate: number
  features: number
  validations: number
}

export function missionStats(runs: MissionExec[]): MissionStats {
  const total = runs.length
  const ok = runs.filter((r) => r.ok).length
  const features = runs.filter((r) => r.kind === "feature").length
  const validations = runs.filter((r) => r.kind === "validation").length
  return {
    total,
    ok,
    successRate: total === 0 ? 0 : ok / total,
    features,
    validations,
  }
}
