/**
 * Missions — persisted schema and pure helpers for the headless orchestrator.
 *
 * A Mission is a higher-altitude workflow than a Loop (`src/loop/`): instead of
 * a flat list of stages it decomposes work into **milestones**, each holding a
 * DAG of **features**, with a **validation** checkpoint per milestone. The
 * orchestrator (`src/mission/orchestrator.ts`) drives one feature at a time as
 * a `goal` command — reusing the same SessionGoal worker the Loop engine uses —
 * and runs a validation worker when a milestone's features are all done.
 *
 * Feature/milestone *status* is persisted on the definition itself so the
 * orchestrator can resume exactly where it left off after a restart. Execution
 * records (`MissionExec`) carry a lease/heartbeat so orphaned runs are
 * reconciled on the next boot, identical to `LoopRun` (`src/loop/schema.ts`).
 *
 * Keep this module free of Scheduler/Session/OpenTUI imports so it can be
 * unit-tested in isolation.
 */

import z from "zod"
import { Log } from "../util/log"
import { isValidModel } from "../loop/schema"

export const HISTORY_LIMIT = 100

/** Mirrors `LOOP_RUN_LEASE_MS`: how long a `running` exec can stay untouched before `restore()` orphans it. */
export const MISSION_EXEC_LEASE_MS = 15_000

/** Per-feature-run wall-clock cap. A hung feature can never hold the single-flight slot forever. */
export const DEFAULT_FEATURE_TIMEOUT_MS = 60 * 60_000
export const MIN_FEATURE_TIMEOUT_MS = 1_000
export const MAX_FEATURE_TIMEOUT_MS = 24 * 60 * 60_000

/** Global cap on concurrently-orchestrating missions (mirrors loop MAX_CONCURRENT_RUNS). */
export const MAX_CONCURRENT_MISSIONS = 2

const log = Log.create({ service: "mission.schema" })

const RESERVED_OBJECTIVES = new Set(["pause", "resume", "clear", "status"])
const TOKEN_BUDGET_FLAG = /--token-budget\b/

// ── Feature ─────────────────────────────────────────────────────────────────

export const FeatureStatusSchema = z.enum(["pending", "running", "done", "blocked", "skipped", "error"])
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>

export const MissionFeatureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  objective: z.string().min(1),
  agent: z.string().min(1),
  /** "providerID/modelID". Undefined => mission worker model, then session default. */
  model: z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .optional(),
  tokenBudget: z.number().int().positive().optional(),
  /** IDs of sibling features (same milestone) that must reach `done` first. */
  dependsOn: z.array(z.string()).default([]),
  status: FeatureStatusSchema.default("pending"),
  /** Last error surfaced by this feature's worker, if any. */
  error: z.string().optional(),
})
export type MissionFeature = z.infer<typeof MissionFeatureSchema>

// ── Milestone ───────────────────────────────────────────────────────────────

export const ValidationPolicySchema = z.enum(["scrutiny", "user-test", "none"])
export type ValidationPolicy = z.infer<typeof ValidationPolicySchema>

export const MilestoneStatusSchema = z.enum(["pending", "running", "validating", "done", "blocked"])
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>

export const MissionMilestoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  features: z.array(MissionFeatureSchema).min(1),
  validation: ValidationPolicySchema.default("scrutiny"),
  status: MilestoneStatusSchema.default("pending"),
})
export type MissionMilestone = z.infer<typeof MissionMilestoneSchema>

// ── Mission ─────────────────────────────────────────────────────────────────

export const MissionModelsSchema = z.object({
  worker: z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .optional(),
  validation: z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .optional(),
  orchestrator: z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .optional(),
})
export type MissionModels = z.infer<typeof MissionModelsSchema>

export const MissionStatusSchema = z.enum(["planning", "ready", "running", "paused", "frozen", "complete", "error"])
export type MissionStatus = z.infer<typeof MissionStatusSchema>

export const MissionDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** The high-level goal agreed during collaborative planning. */
  brief: z.string().min(1),
  milestones: z.array(MissionMilestoneSchema).min(1),
  models: MissionModelsSchema.default({}),
  /** Per-feature-run wall-clock cap in ms. Undefined => DEFAULT_FEATURE_TIMEOUT_MS. */
  timeoutMs: z.number().int().positive().optional(),
  status: MissionStatusSchema.default("ready"),
  createdAt: z.number().int().nonnegative(),
})
export type MissionDefinition = z.infer<typeof MissionDefinitionSchema>

// ── Execution record (lease-bearing, for monitoring + orphan recovery) ────────

export const ExecKindSchema = z.enum(["feature", "validation"])
export type ExecKind = z.infer<typeof ExecKindSchema>

export const ExecStatusSchema = z.enum(["running", "complete", "error", "timeout", "cancelled", "orphaned"])
export type ExecStatus = z.infer<typeof ExecStatusSchema>

export const MissionExecSchema = z.object({
  id: z.string().min(1),
  missionID: z.string().min(1),
  kind: ExecKindSchema,
  /** Feature id (kind=feature) or milestone id (kind=validation). */
  targetID: z.string().min(1),
  targetName: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  status: ExecStatusSchema,
  /** Lease heartbeat, renewed while the owning process drives the exec. */
  heartbeatAt: z.number().int().nonnegative().optional(),
  sessionID: z.string().optional(),
  error: z.string().optional(),
  ok: z.boolean(),
})
export type MissionExec = z.infer<typeof MissionExecSchema>

// ── Validation ────────────────────────────────────────────────────────────────

export function validateFeature(feature: MissionFeature): string | undefined {
  const objective = feature.objective?.trim()
  if (!objective) return "Feature objective is required"
  if (RESERVED_OBJECTIVES.has(objective.toLowerCase())) {
    return `Objective cannot be the reserved word "${objective}"`
  }
  if (TOKEN_BUDGET_FLAG.test(objective)) {
    return 'Objective cannot contain "--token-budget" (use the token budget field instead)'
  }
  if (!feature.name.trim()) return "Feature name cannot be blank"
  if (!feature.agent.trim()) return "Feature agent cannot be blank"
  if (feature.model !== undefined && !isValidModel(feature.model)) {
    return 'Model must be in "providerID/modelID" form'
  }
  if (feature.tokenBudget !== undefined && (!Number.isInteger(feature.tokenBudget) || feature.tokenBudget <= 0)) {
    return "Token budget must be a positive integer"
  }
  return undefined
}

export function validateMilestone(milestone: MissionMilestone): string | undefined {
  if (!milestone.name.trim()) return "Milestone name cannot be blank"
  const ids = new Set<string>()
  for (const feature of milestone.features) {
    if (ids.has(feature.id)) return `Duplicate feature id "${feature.id}" in milestone "${milestone.name}"`
    ids.add(feature.id)
  }
  for (const feature of milestone.features) {
    const err = validateFeature(feature)
    if (err) return err
    for (const dep of feature.dependsOn) {
      if (!ids.has(dep)) return `Feature "${feature.name}" depends on unknown feature id "${dep}"`
      if (dep === feature.id) return `Feature "${feature.name}" cannot depend on itself`
    }
  }
  // Cheap cycle guard: a topological pass must consume every feature.
  if (hasDependencyCycle(milestone.features)) {
    return `Milestone "${milestone.name}" has a circular feature dependency`
  }
  return undefined
}

/** Kahn's algorithm: returns true if the dependency graph cannot be fully ordered. */
function hasDependencyCycle(features: MissionFeature[]): boolean {
  const remaining = new Map(features.map((f) => [f.id, new Set(f.dependsOn)]))
  let progress = true
  while (remaining.size > 0 && progress) {
    progress = false
    for (const [id, deps] of remaining) {
      if ([...deps].every((d) => !remaining.has(d))) {
        remaining.delete(id)
        progress = true
      }
    }
  }
  return remaining.size > 0
}

export function validateDefinition(def: MissionDefinition): string | undefined {
  if (!def.brief.trim()) return "Mission brief is required"
  const milestoneIds = new Set<string>()
  for (const milestone of def.milestones) {
    if (milestoneIds.has(milestone.id)) return `Duplicate milestone id "${milestone.id}"`
    milestoneIds.add(milestone.id)
    const err = validateMilestone(milestone)
    if (err) return err
  }
  if (def.timeoutMs !== undefined) {
    if (!Number.isInteger(def.timeoutMs) || def.timeoutMs < MIN_FEATURE_TIMEOUT_MS) {
      return `Feature timeout must be at least ${MIN_FEATURE_TIMEOUT_MS}ms`
    }
    if (def.timeoutMs > MAX_FEATURE_TIMEOUT_MS) {
      return `Feature timeout cannot exceed ${MAX_FEATURE_TIMEOUT_MS}ms`
    }
  }
  return undefined
}

// ── Sanitizers ──────────────────────────────────────────────────────────────

export function sanitizeDefinition(value: unknown): MissionDefinition | undefined {
  const parsed = MissionDefinitionSchema.safeParse(value)
  if (!parsed.success) {
    log.debug("discarded corrupt mission definition", { issues: parsed.error.issues.slice(0, 3) })
    return undefined
  }
  const def = parsed.data
  const err = validateDefinition(def)
  if (err) {
    log.warn("mission definition failed validation; discarding", { id: def.id, err })
    return undefined
  }
  return def
}

export function sanitizeExec(value: unknown): MissionExec | undefined {
  const parsed = MissionExecSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function generateID(prefix = "mission"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// ── Derived progress helpers (pure; used by orchestrator + TUI) ───────────────

/** The first milestone not yet `done`, or undefined if the mission is complete. */
export function currentMilestone(def: MissionDefinition): MissionMilestone | undefined {
  return def.milestones.find((m) => m.status !== "done")
}

/** Features in a milestone whose deps are all `done`/`skipped` and which are still `pending`. */
export function readyFeatures(milestone: MissionMilestone): MissionFeature[] {
  const settled = new Set(milestone.features.filter((f) => f.status === "done" || f.status === "skipped").map((f) => f.id))
  return milestone.features.filter((f) => f.status === "pending" && f.dependsOn.every((d) => settled.has(d)))
}

/** True if every feature in the milestone has settled to done/skipped. */
export function milestoneFeaturesSettled(milestone: MissionMilestone): boolean {
  return milestone.features.every((f) => f.status === "done" || f.status === "skipped")
}

export type MissionProgress = {
  totalFeatures: number
  doneFeatures: number
  totalMilestones: number
  doneMilestones: number
}

export function progressOf(def: MissionDefinition): MissionProgress {
  let totalFeatures = 0
  let doneFeatures = 0
  for (const m of def.milestones) {
    for (const f of m.features) {
      totalFeatures++
      if (f.status === "done" || f.status === "skipped") doneFeatures++
    }
  }
  return {
    totalFeatures,
    doneFeatures,
    totalMilestones: def.milestones.length,
    doneMilestones: def.milestones.filter((m) => m.status === "done").length,
  }
}

/** Factory's cost heuristic: total runs ≈ #features + 2 * #milestones. */
export function estimateRuns(def: MissionDefinition): number {
  const features = def.milestones.reduce((n, m) => n + m.features.length, 0)
  const validated = def.milestones.filter((m) => m.validation !== "none").length
  return features + 2 * validated
}

// ── Templates ─────────────────────────────────────────────────────────────────

export type MissionTemplate = {
  id: string
  title: string
  description: string
  brief: string
}

export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: "feature-build",
    title: "Build a feature end-to-end",
    description: "Plan, implement, test and review a new feature across the stack",
    brief: "Implement the requested feature end-to-end: data model, API, UI, and tests, validated per milestone.",
  },
  {
    id: "migration",
    title: "Brownfield migration",
    description: "Migrate a subsystem incrementally with validation between phases",
    brief: "Migrate the target subsystem incrementally, keeping the build green and validating after each milestone.",
  },
  {
    id: "research-synthesis",
    title: "Research & synthesis",
    description: "Explore several approaches, then synthesize a recommendation",
    brief: "Investigate the problem from multiple angles, prototype the promising ones, and synthesize a recommendation.",
  },
]

// ── Generation from a planning model ──────────────────────────────────────────

/** Pull the first balanced JSON object out of arbitrary model text (handles code fences/prose). */
function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) return undefined
  return text.slice(start, end + 1)
}

type GeneratedFeature = {
  name?: string
  objective: string
  agent?: string
  model?: string
  tokenBudget?: number
  dependsOn?: string[]
}

type GeneratedMilestone = {
  name?: string
  validation?: ValidationPolicy
  features: GeneratedFeature[]
}

export type GeneratedMission = {
  name?: string
  brief: string
  milestones: GeneratedMilestone[]
  models?: { worker?: string; validation?: string; orchestrator?: string }
}

/** Normalize a model-authored plan into a fully-formed MissionDefinition. */
export function definitionFromGenerated(input: GeneratedMission): MissionDefinition {
  if (!input.brief?.trim()) throw new Error("Generated mission has no brief")
  if (!input.milestones || input.milestones.length === 0) {
    throw new Error("Generated mission has no milestones")
  }
  const milestones: MissionMilestone[] = input.milestones.map((m, mi) => {
    if (!m.features || m.features.length === 0) {
      throw new Error(`Milestone ${mi + 1} has no features`)
    }
    const features: MissionFeature[] = m.features.map((f, fi) => {
      const objective = f.objective?.trim()
      if (!objective) throw new Error(`Milestone ${mi + 1} feature ${fi + 1} needs an objective`)
      const feature: MissionFeature = {
        id: `f${mi + 1}_${fi + 1}`,
        name: f.name?.trim() || deriveName(objective),
        objective,
        agent: f.agent?.trim() || "ralph",
        dependsOn: Array.isArray(f.dependsOn) ? f.dependsOn.filter((d) => typeof d === "string") : [],
        status: "pending",
      }
      if (f.model && isValidModel(f.model)) feature.model = f.model
      if (f.tokenBudget && f.tokenBudget > 0) feature.tokenBudget = Math.floor(f.tokenBudget)
      return feature
    })
    return {
      id: `m${mi + 1}`,
      name: m.name?.trim() || `Milestone ${mi + 1}`,
      features,
      validation: m.validation ?? "scrutiny",
      status: "pending",
    }
  })
  const models: MissionModels = {}
  if (input.models?.worker && isValidModel(input.models.worker)) models.worker = input.models.worker
  if (input.models?.validation && isValidModel(input.models.validation)) models.validation = input.models.validation
  if (input.models?.orchestrator && isValidModel(input.models.orchestrator)) {
    models.orchestrator = input.models.orchestrator
  }
  const def: MissionDefinition = {
    id: generateID(),
    name: input.name?.trim() || milestones[0].name,
    brief: input.brief.trim(),
    milestones,
    models,
    status: "ready",
    createdAt: Date.now(),
  }
  const error = validateDefinition(def)
  if (error) throw new Error(error)
  return def
}

function deriveName(text: string): string {
  const single = text.trim().replace(/\s+/g, " ")
  return single.length <= 48 ? single : `${single.slice(0, 47)}…`
}

/**
 * Parse a model-generated plan into a validated MissionDefinition.
 * Expects `{ name?, brief, milestones: [{ name?, validation?, features: [...] }], models? }`,
 * optionally wrapped in prose/code fences. Throws with a clear message on failure.
 */
export function definitionFromGeneratedText(text: string): MissionDefinition {
  const json = extractJsonObject(text)
  if (!json) throw new Error("The model did not return a JSON plan")
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error("The model's response was not valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Generated plan is not an object")
  const v = parsed as Record<string, unknown>
  const rawMilestones = Array.isArray(v.milestones) ? v.milestones : []
  const milestones: GeneratedMilestone[] = rawMilestones
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    .map((m) => {
      const rawFeatures = Array.isArray(m.features) ? m.features : []
      const features: GeneratedFeature[] = rawFeatures
        .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
        .map((f) => ({
          objective: typeof f.objective === "string" ? f.objective : "",
          ...(typeof f.name === "string" && f.name.trim() ? { name: f.name } : {}),
          ...(typeof f.agent === "string" && f.agent.trim() ? { agent: f.agent } : {}),
          ...(typeof f.model === "string" && isValidModel(f.model) ? { model: f.model } : {}),
          ...(typeof f.tokenBudget === "number" ? { tokenBudget: f.tokenBudget } : {}),
          ...(Array.isArray(f.dependsOn) ? { dependsOn: f.dependsOn.filter((d): d is string => typeof d === "string") } : {}),
        }))
      return {
        features,
        ...(typeof m.name === "string" && m.name.trim() ? { name: m.name } : {}),
        ...(typeof m.validation === "string" && ValidationPolicySchema.safeParse(m.validation).success
          ? { validation: m.validation as ValidationPolicy }
          : {}),
      }
    })
  const models =
    typeof v.models === "object" && v.models !== null ? (v.models as Record<string, unknown>) : undefined
  return definitionFromGenerated({
    brief: typeof v.brief === "string" ? v.brief : "",
    milestones,
    ...(typeof v.name === "string" && v.name.trim() ? { name: v.name } : {}),
    ...(models
      ? {
          models: {
            ...(typeof models.worker === "string" ? { worker: models.worker } : {}),
            ...(typeof models.validation === "string" ? { validation: models.validation } : {}),
            ...(typeof models.orchestrator === "string" ? { orchestrator: models.orchestrator } : {}),
          },
        }
      : {}),
  })
}
