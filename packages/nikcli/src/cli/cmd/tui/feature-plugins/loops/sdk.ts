/**
 * Loops — SDK wrapper for the headless engine.
 *
 * The plugin's reactive runtime still lives in-process (Solid store) for fast
 * UI updates, but the source of truth for definitions, run history, and
 * background work is the server's `loop.*` endpoints. The plugin also
 * subscribes to the bus events published by the engine so live state stays in
 * sync even when the interval trigger fires while the TUI is open.
 */
import type { NikcliClient } from "@nikcli-ai/sdk/v2"
import type { TuiEventBus } from "@nikcli-ai/plugin/tui"
import type { LoopDefinition, LoopTemplate, LoopRun } from "@/loop/schema"
import { definitionFromGenerated, definitionFromGeneratedText, isValidModel, validateDefinition } from "@/loop/schema"

export type { LoopDefinition, LoopTemplate, LoopRun } from "@/loop/schema"

/** Wire types — what the server's runtime map returns per loop. */
export type LoopRuntimeStatus = "idle" | "running" | "paused" | "error"
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
    statusRaw === "running" || statusRaw === "paused" || statusRaw === "error" ? statusRaw : "idle"
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
        agent: typeof st.agent === "string" ? st.agent : "ralph",
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
    enabled: v.enabled,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
  }
}

function asRun(value: unknown): LoopRun | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string" || typeof v.loopID !== "string") return undefined
  if (typeof v.startedAt !== "number") return undefined
  return {
    id: v.id,
    loopID: v.loopID,
    startedAt: v.startedAt,
    ...(typeof v.endedAt === "number" ? { endedAt: v.endedAt } : {}),
    status: typeof v.status === "string" ? (v.status as LoopRun["status"]) : "running",
    ok: v.ok === true,
    ...(typeof v.error === "string" ? { error: v.error } : {}),
    ...(typeof v.sessionID === "string" ? { sessionID: v.sessionID } : {}),
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

export type GeneratedDraft = Parameters<typeof definitionFromGenerated>[0]

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
      name: def.name,
      stages: def.stages,
      trigger: def.trigger,
      ...(def.maxRuns !== undefined ? { maxRuns: def.maxRuns } : {}),
      enabled: def.enabled,
    })
    const saved = asDefinition((res.data as unknown) ?? undefined)
    if (!saved) throw new Error("Server returned an invalid loop definition")
    return saved
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
   * description. Creates a throwaway session, runs the goal command, then
   * parses the first response into a LoopDefinition. The user still confirms
   * before persistence.
   */
  async generateFromDescription(
    description: string,
    opts: { model?: string; agent?: string } = {},
  ): Promise<LoopDefinition> {
    // The server's /loop/generate endpoint handles the LLM call. We use it
    // directly to keep the wire schema (and agent) consistent across clients.
    const res = await this.client.loop.generate({ description, ...opts })
    const def = asDefinition((res.data as unknown) ?? undefined)
    if (!def) {
      // Fallback: if the server returned unparseable, try parsing the response
      // as text. Most useful when the server path returned a 200 with raw text.
      const text = typeof (res.data as unknown) === "string" ? (res.data as unknown as string) : ""
      if (text) return definitionFromGeneratedText(text)
      throw new Error("The model did not return a usable pipeline")
    }
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
