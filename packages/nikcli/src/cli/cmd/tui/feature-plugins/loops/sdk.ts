/**
 * Loops — SDK wrapper for the headless engine.
 *
 * The plugin's reactive runtime still lives in-process (Solid store) for fast
 * UI updates, but the source of truth for definitions, run history, and
 * background work is the server's `loop.*` endpoints. The plugin also
 * subscribes to the bus events published by the engine so live state stays in
 * sync even when the interval trigger fires while the TUI is open.
 */
import type { NikcliClient } from "@nikcli-ai/sdk/httpapi"
import type { TuiEventBus } from "@nikcli-ai/plugin/tui"
// Shapes come from the contract, not from the server module that happens to declare them.
import type { LoopDefinition, LoopTemplate, LoopRun } from "@nikcli-ai/sdk/httpapi"
// Validation still does: these produce the messages shown before a definition is posted, and the
// SDK carries no behavior. See specs/tui-package.md §3.
import {
  DEFAULT_LOOP_AGENT,
  isValidModel,
  validateDefinition,
  type GeneratedLoopDraft,
} from "@nikcli-ai/util/loop-validation"

export type { LoopDefinition, LoopTemplate, LoopRun, LoopPullRequestRef } from "@nikcli-ai/sdk/httpapi"

/** Wire types — what the server's runtime map returns per loop. */
export type LoopRuntimeStatus = "idle" | "running" | "paused" | "error" | "cancelling"
export type LoopRuntime = {
  status: LoopRuntimeStatus
  runs: number
  lastRunAt?: number
  lastError?: string
  sessionID?: string
}

export type ListResult = {
  loops: LoopDefinition[]
  runtimes: Array<{ loopID: string; runtime: LoopRuntime }>
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function asRuntime(value: unknown): LoopRuntime {
  const r = (value ?? {}) as Record<string, unknown>
  const statusRaw = asString(r.status, "idle")
  const status: LoopRuntimeStatus =
    statusRaw === "running" || statusRaw === "paused" || statusRaw === "error" || statusRaw === "cancelling"
      ? statusRaw
      : "idle"
  return {
    status,
    runs: asNumber(r.runs, 0),
    ...(typeof r.lastRunAt === "number" ? { lastRunAt: r.lastRunAt } : {}),
    ...(typeof r.lastError === "string" ? { lastError: r.lastError } : {}),
    ...(typeof r.sessionID === "string" ? { sessionID: r.sessionID } : {}),
  }
}

/** Narrow a possibly-unknown payload into a LoopDefinition. */
function asDefinition(value: unknown): LoopDefinition | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string" || typeof v.name !== "string") return undefined
  if (typeof v.enabled !== "boolean") return undefined
  if (!Array.isArray(v.stages) || v.stages.length === 0) return undefined
  const stages: LoopDefinition["stages"] = v.stages.flatMap((s): LoopDefinition["stages"] => {
    if (!s || typeof s !== "object") return []
    const st = s as Record<string, unknown>
    if (typeof st.objective !== "string" || !st.objective.trim()) return []
    return [
      {
        name: typeof st.name === "string" ? st.name : "stage",
        agent: typeof st.agent === "string" ? st.agent : DEFAULT_LOOP_AGENT,
        ...(typeof st.model === "string" && isValidModel(st.model) ? { model: st.model } : {}),
        objective: st.objective,
        ...(typeof st.tokenBudget === "number" && st.tokenBudget > 0 ? { tokenBudget: st.tokenBudget } : {}),
      },
    ]
  })
  if (stages.length === 0) return undefined
  const trigger = v.trigger as Record<string, unknown> | undefined
  const triggerKind = trigger?.kind
  const triggerNormalized: LoopDefinition["trigger"] =
    triggerKind === "interval" && typeof trigger?.everyMs === "number" && trigger.everyMs > 0
      ? { kind: "interval", everyMs: trigger.everyMs }
      : { kind: "manual" }
  return {
    id: v.id,
    name: v.name,
    stages,
    trigger: triggerNormalized,
    ...(typeof v.maxRuns === "number" && v.maxRuns > 0 ? { maxRuns: v.maxRuns } : {}),
    ...(v.createPR === true ? { createPR: true } : {}),
    // Carried through untouched: this normalizer is also what the TUI PUTs
    // back on edit, and dropping the sandbox handle would strand the loop's
    // worktree and branch a fresh one on the next run.
    ...(v.sandbox === false ? { sandbox: false } : {}),
    ...(asWorktree(v.worktree) ? { worktree: asWorktree(v.worktree)! } : {}),
    enabled: v.enabled,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
  }
}

/** Narrow the persisted sandbox worktree handle. */
function asWorktree(value: unknown): LoopDefinition["worktree"] | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.name !== "string" || typeof v.directory !== "string") return undefined
  if (!v.name || !v.directory) return undefined
  return {
    name: v.name,
    directory: v.directory,
    ...(typeof v.branch === "string" && v.branch ? { branch: v.branch } : {}),
  }
}

function asRun(value: unknown): LoopRun | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string" || typeof v.loopID !== "string") return undefined
  if (typeof v.startedAt !== "number") return undefined
  const pr = v.pullRequest as Record<string, unknown> | undefined
  return {
    id: v.id,
    loopID: v.loopID,
    startedAt: v.startedAt,
    ...(typeof v.endedAt === "number" ? { endedAt: v.endedAt } : {}),
    status: typeof v.status === "string" ? (v.status as LoopRun["status"]) : "running",
    ok: v.ok === true,
    ...(typeof v.error === "string" ? { error: v.error } : {}),
    ...(typeof v.sessionID === "string" ? { sessionID: v.sessionID } : {}),
    ...(pr && typeof pr.number === "number" && typeof pr.url === "string"
      ? {
          pullRequest: {
            number: pr.number,
            url: pr.url,
            branch: typeof pr.branch === "string" ? pr.branch : "",
            base: typeof pr.base === "string" ? pr.base : "",
            ...(typeof pr.title === "string" ? { title: pr.title } : {}),
            action: pr.action === "updated" ? ("updated" as const) : ("created" as const),
          },
        }
      : {}),
  }
}

function asTemplate(value: unknown): LoopTemplate | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string" || typeof v.title !== "string") return undefined
  const draft = (v.draft ?? {}) as Record<string, unknown>
  const rawStages = Array.isArray(draft.stages) ? draft.stages : []
  const stages = rawStages
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({
      objective: typeof s.objective === "string" ? s.objective : "",
      ...(typeof s.name === "string" && s.name.trim() ? { name: s.name } : {}),
      ...(typeof s.agent === "string" && s.agent.trim() ? { agent: s.agent } : {}),
      ...(typeof s.model === "string" && isValidModel(s.model) ? { model: s.model } : {}),
      ...(typeof s.tokenBudget === "number" ? { tokenBudget: s.tokenBudget } : {}),
    }))
    .filter((s) => s.objective.length > 0)
  return {
    id: v.id,
    title: v.title,
    description: typeof v.description === "string" ? v.description : "",
    draft: {
      stages,
      ...(typeof draft.name === "string" ? { name: draft.name } : {}),
      ...(typeof draft.intervalMs === "number" ? { intervalMs: draft.intervalMs } : {}),
      ...(typeof draft.maxRuns === "number" ? { maxRuns: draft.maxRuns } : {}),
    },
  }
}

export type GeneratedDraft = GeneratedLoopDraft

export class LoopApi {
  constructor(private client: NikcliClient) {}

  async list(): Promise<ListResult> {
    const res = await this.client.loop.list()
    const data = res.data as unknown
    if (!data || typeof data !== "object") return { loops: [], runtimes: [] }
    const v = data as { loops?: unknown[]; runtimes?: unknown[] }
    const loops = Array.isArray(v.loops)
      ? v.loops.map(asDefinition).filter((d): d is LoopDefinition => d !== undefined)
      : []
    const runtimes = Array.isArray(v.runtimes)
      ? v.runtimes
          .map((r) => {
            if (!r || typeof r !== "object") return undefined
            const obj = r as Record<string, unknown>
            const id = obj.loopID
            if (typeof id !== "string") return undefined
            return { loopID: id, runtime: asRuntime(obj) }
          })
          .filter((r): r is { loopID: string; runtime: LoopRuntime } => r !== undefined)
      : []
    return { loops, runtimes }
  }

  async get(id: string): Promise<{ loop: LoopDefinition; runtime: LoopRuntime } | undefined> {
    try {
      const res = await this.client.loop.get({ id })
      const data = res.data as unknown
      if (!data || typeof data !== "object") return undefined
      const v = data as { loop?: unknown; runtime?: unknown }
      const loop = v.loop ? asDefinition(v.loop) : undefined
      if (!loop) return undefined
      return { loop, runtime: asRuntime(v.runtime) }
    } catch {
      return undefined
    }
  }

  async upsert(def: LoopDefinition): Promise<LoopDefinition> {
    const error = validateDefinition(def)
    if (error) throw new Error(error)
    const res = await this.client.loop.upsert({
      payload: {
        name: def.name,
        stages: def.stages,
        trigger: def.trigger,
        ...(def.maxRuns !== undefined ? { maxRuns: def.maxRuns } : {}),
        ...(def.createPR === true ? { createPR: true } : {}),
        enabled: def.enabled,
      },
    })
    const saved = asDefinition((res.data as unknown) ?? undefined)
    if (!saved) throw new Error("Server returned an invalid loop definition")
    return saved
  }

  async update(def: LoopDefinition): Promise<LoopDefinition> {
    const error = validateDefinition(def)
    if (error) throw new Error(error)
    const res = await this.client.loop.update({
      id: def.id,
      payload: {
        id: def.id,
        name: def.name,
        stages: def.stages,
        trigger: def.trigger,
        ...(def.maxRuns !== undefined ? { maxRuns: def.maxRuns } : {}),
        ...(def.createPR === true ? { createPR: true } : {}),
        enabled: def.enabled,
        createdAt: def.createdAt,
      },
    })
    const saved = asDefinition((res.data as unknown) ?? undefined)
    if (!saved) throw new Error("Server returned an invalid loop definition")
    return saved
  }

  async getRuntime(id: string): Promise<LoopRuntime | undefined> {
    try {
      const res = await this.client.loop.get({ id })
      const data = res.data as unknown
      if (!data || typeof data !== "object") return undefined
      const v = data as { runtime?: unknown }
      return v.runtime ? asRuntime(v.runtime) : undefined
    } catch {
      return undefined
    }
  }

  async abort(id: string): Promise<boolean> {
    try {
      const loop = this.client.loop as {
        abort?: (parameters: { id: string }) => Promise<{ data: unknown }>
      }
      if (loop.abort) {
        const res = await loop.abort({ id })
        return res.data === true
      }
      return false
    } catch {
      return false
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      const res = await this.client.loop.delete({ id })
      return res.data === true || res.data === undefined
    } catch {
      return false
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<LoopDefinition | undefined> {
    try {
      const res = await this.client.loop.toggle({ id, enabled })
      return asDefinition((res.data as unknown) ?? undefined)
    } catch {
      return undefined
    }
  }

  async run(id: string): Promise<boolean> {
    try {
      await this.client.loop.run({ id })
      return true
    } catch {
      return false
    }
  }

  async pause(id: string): Promise<boolean> {
    try {
      await this.client.loop.pause({ id })
      return true
    } catch {
      return false
    }
  }

  async resume(id: string): Promise<boolean> {
    try {
      await this.client.loop.resume({ id })
      return true
    } catch {
      return false
    }
  }

  async runs(id: string, limit = 50): Promise<LoopRun[]> {
    try {
      const res = await this.client.loop.runs({ id, limit })
      const data = res.data as unknown
      if (!data || typeof data !== "object") return []
      const v = data as { runs?: unknown[] }
      return Array.isArray(v.runs) ? v.runs.map(asRun).filter((r): r is LoopRun => r !== undefined) : []
    } catch {
      return []
    }
  }

  async templates(): Promise<LoopTemplate[]> {
    try {
      const res = await this.client.loop.templates()
      const data = res.data as unknown
      if (!data || typeof data !== "object") return []
      const v = data as { templates?: unknown[] }
      return Array.isArray(v.templates)
        ? v.templates.map(asTemplate).filter((t): t is LoopTemplate => t !== undefined)
        : []
    } catch {
      return []
    }
  }

  /**
   * Ask the configured model to author a pipeline from a natural-language
   * description. The server's `/loop/generate` endpoint handles the LLM call
   * so the wire schema (and agent) stay consistent across clients.
   */
  async generateFromDescription(
    description: string,
    opts: { model?: string; agent?: string } = {},
  ): Promise<LoopDefinition> {
    const res = await this.client.loop.generate({ description, ...opts })
    const def = asDefinition((res.data as unknown) ?? undefined)
    if (!def) throw new Error("The model did not return a usable pipeline")
    return def
  }
}

// ── Bus subscription helper ──────────────────────────────────────────────────

/**
 * Subscribe to loop bus events so the TUI can react to runs started/finished
 * by the headless engine. Returns the unsubscribe function.
 */
export function subscribeLoopEvents(
  bus: TuiEventBus,
  handlers: {
    onUpserted?: (loopID: string) => void
    onRemoved?: (loopID: string) => void
    onRunStarted?: (loopID: string, runID: string, sessionID?: string) => void
    onRunFinished?: (loopID: string, runID: string, status: string, ok: boolean, error?: string) => void
    onRuntimeChanged?: (loopID: string) => void
  },
): () => void {
  const offs: Array<() => void> = []
  if (handlers.onUpserted) offs.push(bus.on("loop.upserted", (e) => handlers.onUpserted?.(e.properties.loopID)))
  if (handlers.onRemoved) offs.push(bus.on("loop.removed", (e) => handlers.onRemoved?.(e.properties.loopID)))
  if (handlers.onRunStarted)
    offs.push(
      bus.on("loop.run.started", (e) =>
        handlers.onRunStarted?.(e.properties.loopID, e.properties.runID, e.properties.sessionID),
      ),
    )
  if (handlers.onRunFinished)
    offs.push(
      bus.on("loop.run.finished", (e) =>
        handlers.onRunFinished?.(
          e.properties.loopID,
          e.properties.runID,
          e.properties.status,
          e.properties.ok,
          e.properties.error,
        ),
      ),
    )
  if (handlers.onRuntimeChanged)
    offs.push(bus.on("loop.runtime.changed", (e) => handlers.onRuntimeChanged?.(e.properties.loopID)))
  return () => {
    for (const off of offs) off()
  }
}
