/**
 * Loops — headless engine.
 *
 * Owns the interval triggers via the core `Scheduler` and drives each run
 * server-side through the existing Goal command. The Goal system iterates
 * autonomously until the agent declares the goal complete/blocked or the
 * iteration/budget cap is hit; this engine only schedules, enforces back-
 * pressure, tracks live status, and reconciles in-flight runs after a restart.
 *
 * Designed to run with the TUI closed: definitions are persisted in `Storage`
 * and the timers live in the server process, so intervals fire regardless of
 * whether any TUI is connected. The TUI plugin subscribes to the bus events
 * published here for live status updates.
 */

import z from "zod"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { Scheduler } from "../scheduler"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "../effect"
import { Effect } from "effect"
import * as Manager from "./manager"
import { MAX_CONCURRENT_RUNS, type LoopDefinition, type LoopRun } from "./schema"

const log = Log.create({ service: "loop.engine" })

// ── Bus events ────────────────────────────────────────────────────────────────

export const LoopEvent = {
  Upserted: BusEvent.define(
    "loop.upserted",
    z.object({
      loopID: z.string(),
    }),
  ),
  Removed: BusEvent.define(
    "loop.removed",
    z.object({
      loopID: z.string(),
    }),
  ),
  RunStarted: BusEvent.define(
    "loop.run.started",
    z.object({
      loopID: z.string(),
      runID: z.string(),
      sessionID: z.string().optional(),
    }),
  ),
  RunFinished: BusEvent.define(
    "loop.run.finished",
    z.object({
      loopID: z.string(),
      runID: z.string(),
      status: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  ),
  /** Emitted whenever the engine's live runtime map changes (subscribed by the TUI sidebar). */
  RuntimeChanged: BusEvent.define(
    "loop.runtime.changed",
    z.object({
      loopID: z.string(),
    }),
  ),
}

// ── Live runtime state ────────────────────────────────────────────────────────

export type RuntimeStatus = "idle" | "running" | "paused" | "error"

export type Runtime = {
  status: RuntimeStatus
  runs: number
  lastRunAt?: number
  lastError?: string
  sessionID?: string
}

const EMPTY: Runtime = { status: "idle", runs: 0 }
const live: Map<string, Runtime> = new Map()
const inFlight: Map<string, Promise<void>> = new Map()

export function runtimeOf(id: string): Runtime {
  return live.get(id) ?? EMPTY
}

function allRuntimes(): Map<string, Runtime> {
  return live
}

function patch(id: string, next: (prev: Runtime) => Runtime): void {
  const prev = live.get(id) ?? EMPTY
  const value = next(prev)
  if (value === prev) return
  if (value.status === "idle" && value.runs === 0 && !value.lastRunAt && !value.lastError && !value.sessionID) {
    live.delete(id)
  } else {
    live.set(id, value)
  }
  void Bus.publish(LoopEvent.RuntimeChanged, { loopID: id })
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const msg = (error as { message?: unknown }).message
    if (typeof msg === "string") return msg
  }
  return String(error)
}

function runningCount(): number {
  let n = 0
  for (const r of live.values()) if (r.status === "running") n += 1
  return n
}

// ── Session helpers ───────────────────────────────────────────────────────────

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
}

// ── One iteration of a loop ──────────────────────────────────────────────────

async function executeStage(
  def: LoopDefinition,
  stage: LoopDefinition["stages"][number],
  sessionID: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const args = stage.tokenBudget ? `${stage.objective} --token-budget ${stage.tokenBudget}` : stage.objective
    const input: SessionPrompt.CommandInput = {
      sessionID,
      command: "goal",
      arguments: args,
      agent: stage.agent,
      ...(stage.model ? { model: stage.model } : {}),
    }
    await runSessionPrompt(
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        return yield* prompt.command(input)
      }),
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
}

async function ensureSession(title: string): Promise<string> {
  const created = await runSession(
    Effect.gen(function* () {
      const service = yield* Session.Service
      return yield* service.create({ title })
    }),
  )
  return created.id
}

/** Create or reuse a session for this loop's run. */
async function ensureLoopSession(def: LoopDefinition, reuse?: string): Promise<string> {
  if (reuse) {
    // Best-effort reuse; if the session was disposed in the meantime we create a new one.
    let existing: Session.Info | undefined
    try {
      existing = await runSession(
        Effect.gen(function* () {
          const service = yield* Session.Service
          return yield* service.getAnyProject(reuse)
        }),
      )
    } catch {
      existing = undefined
    }
    if (existing && existing.id === reuse) return reuse
  }
  return ensureSession(`loop: ${def.name}`)
}

/** Run all stages of a loop sequentially in one session. */
async function executeRun(def: LoopDefinition, run: LoopRun): Promise<void> {
  patch(def.id, (prev) => ({
    ...prev,
    status: "running",
    lastError: undefined,
  }))
  const sessionID = await ensureLoopSession(def, run.sessionID)
  patch(def.id, (prev) => ({ ...prev, sessionID }))

  await Manager.finishRun(def.id, run.id, {
    status: "running",
    ok: false,
    endedAt: run.startedAt,
    sessionID,
  })
  void Bus.publish(LoopEvent.RunStarted, {
    loopID: def.id,
    runID: run.id,
    sessionID,
  })

  let firstError: string | undefined
  for (const stage of def.stages) {
    const result = await executeStage(def, stage, sessionID)
    if (!result.ok) {
      firstError = result.error ?? `Stage "${stage.name}" failed`
      break
    }
  }

  const endedAt = Date.now()
  const ok = firstError === undefined
  await Manager.finishRun(def.id, run.id, {
    status: ok ? "complete" : "error",
    ok,
    endedAt,
    ...(firstError !== undefined ? { error: firstError } : {}),
  })
  void Bus.publish(LoopEvent.RunFinished, {
    loopID: def.id,
    runID: run.id,
    status: ok ? "complete" : "error",
    ok,
    ...(firstError !== undefined ? { error: firstError } : {}),
  })

  if (ok) {
    patch(def.id, (prev) => ({
      ...prev,
      status: "idle",
      runs: prev.runs + 1,
      lastRunAt: endedAt,
    }))
  } else {
    patch(def.id, (prev) => ({
      ...prev,
      status: "error",
      lastError: firstError,
      sessionID: undefined,
    }))
  }
}

/**
 * Run a loop once. Returns immediately if a run is already in flight for this
 * loop, or if global concurrency is at capacity. Errors are caught and surfaced
 * via Bus + Runtime state.
 */
export async function runOnce(id: string): Promise<void> {
  if (inFlight.has(id)) return
  if (runningCount() >= MAX_CONCURRENT_RUNS) {
    log.info("max concurrent runs reached; skipping", { id })
    return
  }
  const def = await Manager.get(id)
  if (!def) {
    log.warn("runOnce called for unknown loop", { id })
    return
  }
  if (!def.enabled) return
  if (runtimeOf(id).status === "paused") return

  // Enforce maxRuns before kicking off a new run.
  if (def.maxRuns !== undefined) {
    const runs = await Manager.countRuns(id)
    if (runs >= def.maxRuns) {
      log.info("loop reached maxRuns; disarming", { id, maxRuns: def.maxRuns })
      patch(id, (prev) => ({ ...prev, status: "idle" }))
      Scheduler.unregister(schedulerID(id))
      void Manager.setEnabled(id, false).catch(() => {})
      return
    }
  }

  const run = await Manager.startRun(id)
  const promise = executeRun(def, run)
  inFlight.set(id, promise)
  try {
    await promise
  } catch (error) {
    const message = describeError(error)
    log.error("run failed", { id, error: message })
    await Manager.finishRun(id, run.id, {
      status: "error",
      ok: false,
      endedAt: Date.now(),
      error: message,
    })
    patch(id, (prev) => ({
      ...prev,
      status: "error",
      lastError: message,
      sessionID: undefined,
    }))
    void Bus.publish(LoopEvent.RunFinished, {
      loopID: id,
      runID: run.id,
      status: "error",
      ok: false,
      error: message,
    })
  } finally {
    inFlight.delete(id)
  }
}

// ── Scheduler arming ─────────────────────────────────────────────────────────

function schedulerID(id: string): string {
  return `loop:${id}`
}

/** Register (or re-register) the interval trigger for one loop. */
export function arm(def: LoopDefinition): void {
  Scheduler.unregister(schedulerID(def.id))
  if (!def.enabled || def.trigger.kind !== "interval") return
  Scheduler.register({
    id: schedulerID(def.id),
    interval: def.trigger.everyMs,
    scope: "instance",
    skipInitialRun: true,
    run: async () => {
      // Re-establish the current instance context so Session/SessionPrompt resolve
      // against the right directory (Scheduler is per-instance).
      await withInstanceAsync({ directory: Instance.directory }, () => runOnce(def.id))
    },
  })
  log.info("armed", { id: def.id, everyMs: def.trigger.everyMs })
}

/** Cancel a loop's interval trigger. */
export function disarm(id: string): void {
  Scheduler.unregister(schedulerID(id))
}

/** Reconcile live timers + runtime state with persisted definitions. */
export async function syncAll(): Promise<void> {
  const defs = await Manager.list()
  const ids = new Set(defs.map((d) => d.id))
  for (const id of Array.from(inFlight.keys())) {
    if (!ids.has(id)) {
      // Definition was deleted while a run was in flight; let it finish naturally.
    }
  }
  for (const def of defs) arm(def)
}

/** Re-arm all enabled interval loops for this instance. Call from InstanceBootstrap. */
export async function restore(): Promise<void> {
  const defs = await Manager.list()
  for (const def of defs) arm(def)
  log.info("restored loops", {
    count: defs.length,
    armed: defs.filter((d) => d.enabled && d.trigger.kind === "interval").length,
  })
}

/** Drop all timers (instance disposal). */
export function dispose(): void {
  // Scheduler.unregister on instance scope is handled by Instance.state finalizer,
  // but we still wipe the local runtime cache so a fresh instance starts clean.
  live.clear()
  inFlight.clear()
}

// ── Reactive read-only accessors (for routes + TUI) ─────────────────────────

export function getRuntime(id: string): Runtime {
  return runtimeOf(id)
}

export function listRuntimes(): Array<{ loopID: string; runtime: Runtime }> {
  const defs = live.size ? Array.from(live.keys()) : []
  return defs.map((id) => ({ loopID: id, runtime: runtimeOf(id) }))
}

/** Reset the local in-memory run counter for a loop. Used after manual run cap edits. */
export function resetRunCount(id: string): void {
  patch(id, (prev) => ({ ...prev, runs: 0 }))
}

/** Public mutator for the runtime status. Used by pause/resume routes. */
export function setRuntimeStatus(id: string, status: RuntimeStatus): void {
  patch(id, (prev) => ({ ...prev, status }))
}
