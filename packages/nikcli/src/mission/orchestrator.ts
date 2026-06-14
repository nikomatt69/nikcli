/**
 * Missions — headless orchestrator.
 *
 * Drives a Mission to completion by running one feature at a time as a `goal`
 * command (the same SessionGoal worker the Loop engine uses, see
 * `src/loop/engine.ts`), then running a validation worker when a milestone's
 * features are all settled. Feature/milestone status is persisted on the
 * definition after every step, so a restart resumes exactly where it left off.
 *
 * Reuses the Loop engine's operational guarantees verbatim: a synchronous
 * single-flight claim per mission, a global concurrency cap, per-feature
 * wall-clock timeouts bridged to `prompt.cancel`, a lease/heartbeat on the
 * active execution record so `restore()` can reconcile orphans, in-flight
 * abort, and Bus events for the TUI to subscribe to.
 *
 * All per-instance state lives in `Instance.state` so missions in different
 * projects can't collide.
 */

import z from "zod"
import { Effect } from "effect"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { runPromiseWithLayer, withCurrentInstance } from "../effect"
import * as Manager from "./manager"
import {
  DEFAULT_FEATURE_TIMEOUT_MS,
  ExecStatusSchema,
  MAX_CONCURRENT_MISSIONS,
  MAX_FEATURE_TIMEOUT_MS,
  MIN_FEATURE_TIMEOUT_MS,
  MISSION_EXEC_LEASE_MS,
  currentMilestone,
  milestoneFeaturesSettled,
  progressOf,
  readyFeatures,
  type ExecKind,
  type MissionDefinition,
  type MissionExec,
  type MissionFeature,
  type MissionMilestone,
} from "./schema"

const log = Log.create({ service: "mission.orchestrator" })

// ── Bus events ────────────────────────────────────────────────────────────────

export const MissionEvent = {
  Upserted: BusEvent.define("mission.upserted", z.object({ missionID: z.string() })),
  Removed: BusEvent.define("mission.removed", z.object({ missionID: z.string() })),
  Started: BusEvent.define("mission.started", z.object({ missionID: z.string() })),
  Finished: BusEvent.define(
    "mission.finished",
    z.object({
      missionID: z.string(),
      status: z.enum(["complete", "error", "paused", "frozen"]),
      error: z.string().optional(),
    }),
  ),
  ExecStarted: BusEvent.define(
    "mission.exec.started",
    z.object({
      missionID: z.string(),
      execID: z.string(),
      kind: z.enum(["feature", "validation"]),
      targetID: z.string(),
      targetName: z.string(),
      sessionID: z.string(),
    }),
  ),
  ExecFinished: BusEvent.define(
    "mission.exec.finished",
    z.object({
      missionID: z.string(),
      execID: z.string(),
      kind: z.enum(["feature", "validation"]),
      targetID: z.string(),
      status: ExecStatusSchema,
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  ),
  RuntimeChanged: BusEvent.define("mission.runtime.changed", z.object({ missionID: z.string() })),
  Aborted: BusEvent.define("mission.aborted", z.object({ missionID: z.string(), reason: z.string() })),
}

// ── Live runtime state ──────────────────────────────────────────────────────

export type RuntimeStatus = "idle" | "running" | "paused" | "error" | "cancelling"

export type Runtime = {
  status: RuntimeStatus
  sessionID?: string
  currentMilestoneID?: string
  currentFeatureID?: string
  doneFeatures: number
  totalFeatures: number
  lastError?: string
  lastRunAt?: number
}

const EMPTY: Runtime = { status: "idle", doneFeatures: 0, totalFeatures: 0 }

type InFlight = {
  promise: Promise<void>
  controller: AbortController
  execID?: string
  sessionID?: string
}

type EngineState = {
  live: Map<string, Runtime>
  inFlight: Map<string, InFlight>
}

const state = Instance.state(
  (): EngineState => ({ live: new Map(), inFlight: new Map() }),
  async (entry) => {
    for (const slot of entry.inFlight.values()) slot.controller.abort()
    entry.inFlight.clear()
    entry.live.clear()
  },
)

function instanceState(): EngineState {
  return state()
}

export function runtimeOf(id: string): Runtime {
  return instanceState().live.get(id) ?? EMPTY
}

function patch(id: string, next: (prev: Runtime) => Runtime): void {
  const { live } = instanceState()
  const prev = live.get(id) ?? EMPTY
  const value = next(prev)
  if (value === prev) return
  if (value.status === "idle" && value.doneFeatures === 0 && !value.lastError && !value.sessionID) {
    live.delete(id)
  } else {
    live.set(id, value)
  }
  void Bus.publish(MissionEvent.RuntimeChanged, { missionID: id })
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const msg = (error as { message?: unknown }).message
    if (typeof msg === "string") return msg
  }
  return String(error)
}

// ── Session helpers ───────────────────────────────────────────────────────────

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
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

async function promptCancel(sessionID: string): Promise<void> {
  await runSessionPrompt(
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      yield* prompt.cancel(sessionID)
    }),
  )
}

// ── Worker invocation ─────────────────────────────────────────────────────────

/**
 * Run a single `goal` command in the mission session, bridging the parent abort
 * signal and a per-worker timeout to `prompt.cancel`. Returns ok/error/timeout.
 */
async function runGoal(
  args: {
    sessionID: string
    objective: string
    agent: string
    model?: string
    tokenBudget?: number
    timeoutMs: number
  },
  parentSignal: AbortSignal,
): Promise<{ ok: boolean; error?: string; timedOut: boolean }> {
  if (parentSignal.aborted) return { ok: false, error: "aborted", timedOut: false }

  const ctrl = new AbortController()
  const onParentAbort = () => ctrl.abort(parentSignal.reason)
  parentSignal.addEventListener("abort", onParentAbort, { once: true })
  const timeout = setTimeout(() => ctrl.abort("timeout"), args.timeoutMs)
  const onAbort = () => {
    promptCancel(args.sessionID).catch((error) =>
      log.warn("prompt cancel on abort failed", {
        sessionID: args.sessionID,
        error: describeError(error),
      }),
    )
  }
  ctrl.signal.addEventListener("abort", onAbort, { once: true })

  try {
    const objective = args.tokenBudget ? `${args.objective} --token-budget ${args.tokenBudget}` : args.objective
    const input: SessionPrompt.CommandInput = {
      sessionID: args.sessionID,
      command: "goal",
      arguments: objective,
      agent: args.agent,
      ...(args.model ? { model: args.model } : {}),
    }
    await runSessionPrompt(
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        return yield* prompt.command(input)
      }),
    )
    const timedOut = ctrl.signal.aborted && ctrl.signal.reason === "timeout"
    if (ctrl.signal.aborted)
      return {
        ok: false,
        error: timedOut ? "Worker timed out" : "aborted",
        timedOut,
      }
    return { ok: true, timedOut: false }
  } catch (error) {
    const timedOut = ctrl.signal.aborted && ctrl.signal.reason === "timeout"
    return { ok: false, error: describeError(error), timedOut }
  } finally {
    clearTimeout(timeout)
    parentSignal.removeEventListener("abort", onParentAbort)
    ctrl.signal.removeEventListener("abort", onAbort)
  }
}

/** Test-only seam: lets tests stub worker execution without a SessionPrompt layer. */
let goalRunnerOverride: typeof runGoal | undefined
export function _internalSetGoalRunner(fn?: typeof runGoal): void {
  goalRunnerOverride = fn
}

function execStatusFor(result: { ok: boolean; timedOut: boolean }, aborted: boolean): MissionExec["status"] {
  if (result.timedOut) return "timeout"
  if (aborted) return "cancelled"
  return result.ok ? "complete" : "error"
}

// ── One feature / one validation ───────────────────────────────────────────────

async function runOneExec(
  def: MissionDefinition,
  kind: ExecKind,
  target: {
    id: string
    name: string
    objective: string
    agent: string
    model?: string
    tokenBudget?: number
  },
  sessionID: string,
  signal: AbortSignal,
  timeoutMs: number,
  slot: InFlight,
): Promise<{ ok: boolean; error?: string; timedOut: boolean }> {
  const exec = await Manager.startExec(def.id, kind, target.id, target.name, sessionID)
  slot.execID = exec.id
  const heartbeat = setInterval(() => void Manager.touchExec(def.id, exec.id), Math.floor(MISSION_EXEC_LEASE_MS / 3))
  void Bus.publish(MissionEvent.ExecStarted, {
    missionID: def.id,
    execID: exec.id,
    kind,
    targetID: target.id,
    targetName: target.name,
    sessionID,
  })
  try {
    const result = await (goalRunnerOverride ?? runGoal)(
      {
        sessionID,
        objective: target.objective,
        agent: target.agent,
        ...(target.model ? { model: target.model } : {}),
        ...(target.tokenBudget ? { tokenBudget: target.tokenBudget } : {}),
        timeoutMs,
      },
      signal,
    )
    const status = execStatusFor(result, signal.aborted && !result.timedOut)
    await Manager.finishExec(def.id, exec.id, {
      status,
      ok: result.ok,
      endedAt: Date.now(),
      ...(result.error !== undefined ? { error: result.error } : {}),
    })
    void Bus.publish(MissionEvent.ExecFinished, {
      missionID: def.id,
      execID: exec.id,
      kind,
      targetID: target.id,
      status,
      ok: result.ok,
      ...(result.error !== undefined ? { error: result.error } : {}),
    })
    return result
  } finally {
    clearInterval(heartbeat)
    slot.execID = undefined
  }
}

function validationObjective(milestone: MissionMilestone): string {
  const features = milestone.features.map((f) => `- ${f.name}: ${f.objective}`).join("\n")
  if (milestone.validation === "user-test") {
    return [
      `Validate milestone "${milestone.name}" from a user's perspective.`,
      "Exercise the delivered features end-to-end and confirm they behave correctly.",
      "If anything is broken or incomplete, fix it until the milestone genuinely works.",
      "Features in this milestone:",
      features,
    ].join("\n")
  }
  return [
    `Review and validate the work done for milestone "${milestone.name}".`,
    "Scrutinize correctness, run the relevant tests, and fix any regressions or gaps you find.",
    "Stop only once the milestone's features are verifiably complete and the build/tests are green.",
    "Features in this milestone:",
    features,
  ].join("\n")
}

// ── Orchestration walk ─────────────────────────────────────────────────────────

function featureTimeoutMs(def: MissionDefinition): number {
  return Math.min(Math.max(def.timeoutMs ?? DEFAULT_FEATURE_TIMEOUT_MS, MIN_FEATURE_TIMEOUT_MS), MAX_FEATURE_TIMEOUT_MS)
}

/**
 * Drive the mission forward until it completes, errors, is paused, or is
 * aborted. Picks the current (first non-done) milestone, runs its ready
 * features sequentially, then runs validation, then advances.
 */
async function orchestrate(missionID: string, signal: AbortSignal, slot: InFlight): Promise<void> {
  const sessionID = await ensureSession(`mission: ${(await Manager.get(missionID))?.name ?? missionID}`)
  slot.sessionID = sessionID
  patch(missionID, (prev) => ({
    ...prev,
    status: "running",
    sessionID,
    lastError: undefined,
  }))
  void Bus.publish(MissionEvent.Started, { missionID })

  const timeoutMs = featureTimeoutMs(await requireDef(missionID))

  // Re-read the definition each loop so user intervention (skip/add/drop) and
  // persisted feature status are always respected.
  for (;;) {
    if (signal.aborted) return finalize(missionID, "cancelled-or-paused")
    const def = await Manager.get(missionID)
    if (!def) return
    if (def.status === "paused" || runtimeOf(missionID).status === "paused") {
      return finalize(missionID, "paused")
    }

    const milestone = currentMilestone(def)
    if (!milestone) {
      await Manager.setStatus(missionID, "complete")
      patch(missionID, (prev) => ({
        ...prev,
        status: "idle",
        lastRunAt: Date.now(),
        currentFeatureID: undefined,
      }))
      void Bus.publish(MissionEvent.Finished, {
        missionID,
        status: "complete",
      })
      return
    }

    if (milestone.status === "pending") await Manager.setMilestoneStatus(missionID, milestone.id, "running")
    patch(missionID, (prev) => ({ ...prev, currentMilestoneID: milestone.id }))

    // ── Run the next ready feature, if any ──────────────────────────────────
    const ready = readyFeatures(milestone)
    if (ready.length > 0) {
      const feature = ready[0]
      patch(missionID, (prev) => ({
        ...prev,
        currentFeatureID: feature.id,
        ...progressInto(def),
      }))
      await Manager.setFeatureStatus(missionID, feature.id, "running")
      const result = await runOneFeature(def, feature, sessionID, signal, timeoutMs, slot)
      if (result.timedOut || (!result.ok && !signal.aborted)) {
        await Manager.setFeatureStatus(missionID, feature.id, "error", result.error)
        await Manager.setMilestoneStatus(missionID, milestone.id, "blocked")
        await Manager.setStatus(missionID, "error")
        patch(missionID, (prev) => ({
          ...prev,
          status: "error",
          lastError: result.error,
          currentFeatureID: undefined,
        }))
        void Bus.publish(MissionEvent.Finished, {
          missionID,
          status: "error",
          ...(result.error ? { error: result.error } : {}),
        })
        return
      }
      if (signal.aborted) return finalize(missionID, "cancelled-or-paused")
      await Manager.setFeatureStatus(missionID, feature.id, "done")
      continue
    }

    // ── No ready features: either all settled (validate) or genuinely stuck ──
    const fresh = (await Manager.get(missionID))?.milestones.find((m) => m.id === milestone.id)
    if (!fresh) return
    if (!milestoneFeaturesSettled(fresh)) {
      // Remaining features are blocked by unsatisfiable deps (deps that errored).
      await Manager.setMilestoneStatus(missionID, milestone.id, "blocked")
      await Manager.setStatus(missionID, "error")
      const err = "Milestone has features blocked by failed dependencies"
      patch(missionID, (prev) => ({
        ...prev,
        status: "error",
        lastError: err,
        currentFeatureID: undefined,
      }))
      void Bus.publish(MissionEvent.Finished, {
        missionID,
        status: "error",
        error: err,
      })
      return
    }

    if (fresh.validation !== "none" && fresh.status !== "validating") {
      await Manager.setMilestoneStatus(missionID, milestone.id, "validating")
      patch(missionID, (prev) => ({ ...prev, currentFeatureID: undefined }))
      const result = await runOneExec(
        def,
        "validation",
        {
          id: milestone.id,
          name: `validate ${milestone.name}`,
          objective: validationObjective(fresh),
          agent: "general",
          model: def.models.validation,
        },
        sessionID,
        signal,
        timeoutMs,
        slot,
      )
      if (result.timedOut || (!result.ok && !signal.aborted)) {
        await Manager.setMilestoneStatus(missionID, milestone.id, "blocked")
        await Manager.setStatus(missionID, "error")
        patch(missionID, (prev) => ({
          ...prev,
          status: "error",
          lastError: result.error,
        }))
        void Bus.publish(MissionEvent.Finished, {
          missionID,
          status: "error",
          ...(result.error ? { error: result.error } : {}),
        })
        return
      }
      if (signal.aborted) return finalize(missionID, "cancelled-or-paused")
    }

    await Manager.setMilestoneStatus(missionID, milestone.id, "done")
    const progressDef = (await Manager.get(missionID)) ?? def
    patch(missionID, (prev) => ({ ...prev, ...progressInto(progressDef) }))
  }
}

function progressInto(def: MissionDefinition): Partial<Runtime> {
  const p = progressOf(def)
  return { doneFeatures: p.doneFeatures, totalFeatures: p.totalFeatures }
}

async function runOneFeature(
  def: MissionDefinition,
  feature: MissionFeature,
  sessionID: string,
  signal: AbortSignal,
  timeoutMs: number,
  slot: InFlight,
) {
  return runOneExec(
    def,
    "feature",
    {
      id: feature.id,
      name: feature.name,
      objective: feature.objective,
      agent: feature.agent,
      model: feature.model ?? def.models.worker,
      ...(feature.tokenBudget ? { tokenBudget: feature.tokenBudget } : {}),
    },
    sessionID,
    signal,
    timeoutMs,
    slot,
  )
}

async function requireDef(missionID: string): Promise<MissionDefinition> {
  const def = await Manager.get(missionID)
  if (!def) throw new Error(`Mission ${missionID} not found`)
  return def
}

function finalize(missionID: string, reason: "paused" | "cancelled-or-paused"): void {
  const status = runtimeOf(missionID).status === "cancelling" ? "idle" : "paused"
  patch(missionID, (prev) => ({
    ...prev,
    status: status === "idle" ? "idle" : "paused",
  }))
  void Bus.publish(MissionEvent.Finished, { missionID, status: "paused" })
  log.info("orchestration paused/stopped", { missionID, reason })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start (or resume) orchestrating a mission. Returns immediately if it is
 * already in flight, or if the global concurrency cap is reached. Errors are
 * caught and surfaced via Bus + Runtime state.
 */
export async function start(missionID: string): Promise<void> {
  const { inFlight } = instanceState()
  if (inFlight.has(missionID)) return
  const ctrl = new AbortController()
  const slot: InFlight = { controller: ctrl, promise: Promise.resolve() }
  inFlight.set(missionID, slot)

  try {
    if (inFlight.size > MAX_CONCURRENT_MISSIONS) {
      log.info("max concurrent missions reached; skipping", { missionID })
      void Bus.publish(MissionEvent.Aborted, { missionID, reason: "capacity" })
      return
    }
    const def = await Manager.get(missionID)
    if (!def) {
      log.warn("start called for unknown mission", { missionID })
      return
    }
    if (def.status === "complete") return
    if (def.status === "paused" || def.status === "frozen") {
      // Resuming clears the persisted pause flag.
      await Manager.setStatus(missionID, "running")
    }

    const real = (async () => {
      try {
        await orchestrate(missionID, ctrl.signal, slot)
      } catch (error) {
        const message = describeError(error)
        log.error("orchestration failed", { missionID, error: message })
        await Manager.setStatus(missionID, "error").catch(() => {})
        patch(missionID, (prev) => ({
          ...prev,
          status: "error",
          lastError: message,
        }))
        void Bus.publish(MissionEvent.Finished, {
          missionID,
          status: "error",
          error: message,
        })
      }
    })()
    slot.promise = real
    await real
  } finally {
    inFlight.delete(missionID)
  }
}

/** Pause an in-flight mission: persists the flag and aborts the current worker. */
export async function pause(missionID: string): Promise<void> {
  await Manager.setStatus(missionID, "paused")
  patch(missionID, (prev) => ({ ...prev, status: "paused" }))
  const slot = instanceState().inFlight.get(missionID)
  if (slot) {
    slot.controller.abort("pause")
    if (slot.sessionID) await promptCancel(slot.sessionID).catch(() => {})
  }
  void Bus.publish(MissionEvent.Aborted, { missionID, reason: "user-pause" })
}

/** Cancel an in-flight mission and freeze it for reassessment. */
export async function cancel(missionID: string): Promise<void> {
  const slot = instanceState().inFlight.get(missionID)
  patch(missionID, (prev) => ({ ...prev, status: "cancelling" }))
  await Manager.setStatus(missionID, "frozen")
  if (slot) {
    slot.controller.abort("cancel")
    if (slot.sessionID) await promptCancel(slot.sessionID).catch(() => {})
    try {
      await slot.promise
    } catch {
      // best-effort
    }
  }
  patch(missionID, (prev) => ({ ...prev, status: "idle" }))
  void Bus.publish(MissionEvent.Aborted, { missionID, reason: "user-cancel" })
}

/** Return the in-flight promise so callers can await completion (used before remove). */
export function inflight(missionID: string): Promise<void> | undefined {
  return instanceState().inFlight.get(missionID)?.promise
}

/**
 * Rehydrate runtime from persisted state and reconcile orphaned execs. Call
 * from `InstanceBootstrap`. Does NOT auto-resume missions — that is an explicit
 * user action — but it does surface any mission left mid-flight by a crash.
 */
export async function restore(): Promise<void> {
  const defs = await Manager.list()
  for (const def of defs) {
    const p = progressOf(def)
    const status: RuntimeStatus = def.status === "running" ? "paused" : def.status === "error" ? "error" : "idle"
    if (p.doneFeatures > 0 || def.status === "error" || def.status === "running") {
      instanceState().live.set(def.id, {
        status,
        doneFeatures: p.doneFeatures,
        totalFeatures: p.totalFeatures,
      })
    }
    // A mission persisted as "running" but with no live process is stranded:
    // demote it to "paused" so the user can explicitly resume it.
    if (def.status === "running") await Manager.setStatus(def.id, "paused").catch(() => {})
  }

  const stale = await Manager.listRunningExecs()
  const cutoff = Date.now() - MISSION_EXEC_LEASE_MS
  const isExpired = (e: MissionExec) => (e.heartbeatAt ?? e.startedAt) < cutoff
  for (const exec of stale) {
    if (isExpired(exec)) {
      log.warn("orphaning stale mission exec", {
        missionID: exec.missionID,
        execID: exec.id,
      })
      await Manager.orphanExec(exec.missionID, exec.id)
      void Bus.publish(MissionEvent.ExecFinished, {
        missionID: exec.missionID,
        execID: exec.id,
        kind: exec.kind,
        targetID: exec.targetID,
        status: "orphaned",
        ok: false,
        error: "Process exited before the exec finished",
      })
    }
  }

  log.info("restored missions", {
    count: defs.length,
    orphaned: stale.filter(isExpired).length,
  })
}

export function dispose(): void {
  const { inFlight, live } = instanceState()
  for (const slot of inFlight.values()) slot.controller.abort()
  inFlight.clear()
  live.clear()
}

export function getRuntime(id: string): Runtime {
  return runtimeOf(id)
}

export function listRuntimes(): Array<{ missionID: string; runtime: Runtime }> {
  return Array.from(instanceState().live.entries()).map(([missionID, runtime]) => ({ missionID, runtime }))
}

/** Test/debug helper: snapshot the engine state for assertions. */
export function _internalSnapshot(): {
  live: Array<[string, Runtime]>
  inFlight: string[]
} {
  const { live, inFlight } = instanceState()
  return {
    live: Array.from(live.entries()),
    inFlight: Array.from(inFlight.keys()),
  }
}
