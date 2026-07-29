/**
 * Loops — headless engine.
 *
 * Owns the interval triggers via the core `Scheduler` and drives each run
 * server-side through the existing Goal command. Each run is a single
 * `SessionPrompt.command({ command: "goal" })` call: the agent's own goal loop
 * (see `src/session/goal.ts` and `nextGoalPrompt` in `src/session/prompt.ts`)
 * is responsible for the until-done iteration; this engine only handles
 * scheduling, single-flight, concurrency back-pressure, maxRuns enforcement,
 * in-flight abort, persistence, and live status tracking.
 *
 * All per-instance state (`live` runtime map, `inFlight` slot map) lives in
 * `Instance.state` so loops in different projects can't collide. Definitions
 * are persisted in `Storage`; timers are re-armed by `restore()` and stale
 * `running` runs are reconciled to `"orphaned"` on the same call.
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
import { PermissionNext } from "../permission/next"
import { RunSandbox } from "../worktree/sandbox"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "../effect"
import { Effect, Schema } from "effect"
import * as Manager from "./manager"
import {
  DEFAULT_LOOP_AGENT,
  DEFAULT_RUN_TIMEOUT_MS,
  LOOP_RUN_LEASE_MS,
  LoopRunStatusEffect,
  LoopRunStatusSchema,
  MAX_CONCURRENT_RUNS,
  MAX_RUN_TIMEOUT_MS,
  MIN_RUN_TIMEOUT_MS,
  isSandboxed,
  type LoopDefinition,
  type LoopPullRequestRef,
  type LoopRun,
  type LoopRunStatus,
} from "./schema"
import * as PR from "./pr"

const log = Log.create({ service: "loop.engine" })

// ── Bus events ────────────────────────────────────────────────────────────────

export const LoopEvent = {
  Upserted: BusEvent.schema(
    "loop.upserted",
    Schema.Struct({
      loopID: Schema.String,
    }),
  ),
  Removed: BusEvent.schema(
    "loop.removed",
    Schema.Struct({
      loopID: Schema.String,
    }),
  ),
  RunStarted: BusEvent.schema(
    "loop.run.started",
    Schema.Struct({
      loopID: Schema.String,
      runID: Schema.String,
      sessionID: Schema.String,
    }),
  ),
  RunFinished: BusEvent.schema(
    "loop.run.finished",
    Schema.Struct({
      loopID: Schema.String,
      runID: Schema.String,
      sessionID: Schema.optional(Schema.String),
      status: LoopRunStatusEffect,
      ok: Schema.Boolean,
      error: Schema.optional(Schema.String),
    }),
  ),
  /** Emitted whenever the engine's live runtime map changes (subscribed by the TUI sidebar). */
  RuntimeChanged: BusEvent.schema(
    "loop.runtime.changed",
    Schema.Struct({
      loopID: Schema.String,
    }),
  ),
  /** Emitted when the engine refuses to start a run (or aborts one in flight). */
  Aborted: BusEvent.schema(
    "loop.aborted",
    Schema.Struct({
      loopID: Schema.String,
      runID: Schema.optional(Schema.String),
      reason: Schema.String,
    }),
  ),
}

// ── Live runtime state ────────────────────────────────────────────────────────

export type RuntimeStatus = "idle" | "running" | "paused" | "error" | "cancelling"

export type Runtime = {
  status: RuntimeStatus
  runs: number
  lastRunAt?: number
  lastError?: string
  sessionID?: string
}

const EMPTY: Runtime = { status: "idle", runs: 0 }

type EngineState = {
  live: Map<string, Runtime>
  inFlight: Map<string, InFlightRun>
}

type InFlightRun = {
  promise: Promise<void>
  controller: AbortController
  runID?: string
  sessionID?: string
  /** Sandbox worktree the run is bound to; undefined when running un-sandboxed. */
  directory?: string
}

const createEngineState = (): EngineState => ({
  live: new Map(),
  inFlight: new Map(),
})

/**
 * Per-instance state, identical pattern to `Scheduler` (`src/scheduler/index.ts`).
 * Loops in different projects resolve to different state objects, so `loop_aaa`
 * in project A and `loop_aaa` in project B do not collide.
 */
const state = Instance.state(
  () => createEngineState(),
  async (entry) => {
    for (const slot of entry.inFlight.values()) slot.controller.abort()
    entry.inFlight.clear()
    entry.live.clear()
  },
)

/** Resolve the engine state for the *current* instance. */
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

// ── Session helpers ───────────────────────────────────────────────────────────

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
}

// ── Sandbox ──────────────────────────────────────────────────────────────────

/**
 * Rebind the current instance to the loop's sandbox worktree for the duration
 * of `fn`. Everything that touches the workspace — session creation, the goal
 * command, cancellation — must go through here so tools resolve paths inside
 * the sandbox (`Instance.directory`) instead of the user's checkout.
 *
 * Bookkeeping (`Manager`) deliberately stays on the host instance: run history
 * and definitions belong to the project, not to a disposable worktree.
 */
function inSandbox<T>(directory: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!directory) return fn()
  return withInstanceAsync({ directory }, fn)
}

/**
 * Resolve (creating on first use) the isolated worktree this loop runs in, and
 * persist the handle so later runs reuse it. Returns `undefined` when the loop
 * opted out of sandboxing or the project cannot be sandboxed — the run then
 * happens in the host directory, exactly as before.
 */
async function ensureSandbox(def: LoopDefinition): Promise<RunSandbox.Info | undefined> {
  if (!isSandboxed(def)) return undefined
  const sandbox = await RunSandbox.ensure({
    hostDirectory: Instance.directory,
    name: `loop-${def.name}`,
    branchPrefix: "nikcli/loop",
    ...(def.worktree ? { existing: def.worktree } : {}),
  })
  if (sandbox && sandbox.directory !== def.worktree?.directory) {
    await Manager.setWorktree(def.id, sandbox).catch((error) =>
      log.warn("failed to persist sandbox worktree", {
        loopID: def.id,
        error: describeError(error),
      }),
    )
  }
  return sandbox
}

// ── One iteration of a loop ──────────────────────────────────────────────────

async function executeStage(
  def: LoopDefinition,
  stage: LoopDefinition["stages"][number],
  sessionID: string,
  signal: AbortSignal,
  directory?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const args = stage.tokenBudget ? `${stage.objective} --token-budget ${stage.tokenBudget}` : stage.objective
    const input: SessionPrompt.CommandInput = {
      sessionID,
      command: "goal",
      arguments: args,
      agent: stage.agent || DEFAULT_LOOP_AGENT,
      ...(stage.model ? { model: stage.model } : {}),
    }
    await inSandbox(directory, () =>
      runSessionPrompt(
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          return yield* prompt.command(input)
        }),
      ),
    )
    if (signal.aborted) {
      return { ok: false, error: "aborted" }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
}

async function ensureSession(title: string, sandboxed: boolean, directory?: string): Promise<string> {
  const created = await inSandbox(directory, () =>
    runSession(
      Effect.gen(function* () {
        const service = yield* Session.Service
        return yield* service.create({
          title,
          // A loop has nobody to answer a permission prompt. Granting full
          // access is only defensible because the run is confined to its own
          // worktree; un-sandboxed loops keep the ordinary rules.
          ...(sandboxed ? { permission: PermissionNext.fullAccess() } : {}),
        })
      }),
    ),
  )
  return created.id
}

/** Create or reuse a session for this loop's run. */
async function ensureLoopSession(def: LoopDefinition, sandbox?: RunSandbox.Info, reuse?: string): Promise<string> {
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
    // Never reuse a session bound to some other directory: a host session
    // reused for a sandboxed run would drag the work back into the user's
    // checkout. A miss just costs one extra session.
    const bound = !sandbox || existing?.directory === sandbox.directory
    if (existing && existing.id === reuse && bound) return reuse
  }
  return ensureSession(`loop: ${def.name}`, sandbox !== undefined, sandbox?.directory)
}

/** Cancel the SessionPrompt driving a session. Throws if the prompt layer fails. */
async function promptCancel(sessionID: string, directory?: string): Promise<void> {
  await inSandbox(directory, () =>
    runSessionPrompt(
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        yield* prompt.cancel(sessionID)
      }),
    ),
  )
}

/**
 * Cancel the SessionPrompt for an in-flight run. Best-effort: aborting the
 * controller fires the abort listener that `executeRun` registers once the
 * session is known, which cancels the prompt; the explicit `promptCancel`
 * below covers the window before that listener exists. The session itself is
 * left intact so the user can still inspect the work that was done.
 */
async function cancelInFlightRun(loopID: string, runID: string | undefined, sessionID?: string): Promise<void> {
  const slot = instanceState().inFlight.get(loopID)
  slot?.controller.abort()
  if (sessionID) {
    try {
      await promptCancel(sessionID, slot?.directory)
    } catch (error) {
      log.warn("session cancel failed", {
        loopID,
        runID,
        error: describeError(error),
      })
    }
  }
}

/** Test-only seam: lets tests stub stage execution without a SessionPrompt layer. */
let stageExecutorOverride: typeof executeStage | undefined
export function _internalSetStageExecutor(fn?: typeof executeStage): void {
  stageExecutorOverride = fn
}

/** Test-only seam: lets tests stub the auto-PR hook without invoking `gh`. */
let prHookOverride: ((input: PR.CreatePullRequestOptions) => Promise<LoopPullRequestRef | undefined>) | undefined
export function _internalSetPullRequestHook(
  fn?: (input: PR.CreatePullRequestOptions) => Promise<LoopPullRequestRef | undefined>,
): void {
  prHookOverride = fn
}

/** Run all stages of a loop sequentially in one session. */
async function executeRun(
  def: LoopDefinition,
  run: LoopRun,
  signal: AbortSignal,
  onSessionID?: (sessionID: string) => void,
  sandbox?: RunSandbox.Info,
): Promise<{
  ok: boolean
  firstError?: string
  sessionID: string
}> {
  patch(def.id, (prev) => ({
    ...prev,
    status: "running",
    lastError: undefined,
  }))
  const sessionID = await ensureLoopSession(def, sandbox, run.sessionID)
  onSessionID?.(sessionID)
  patch(def.id, (prev) => ({ ...prev, sessionID }))

  await Manager.attachRunSession(def.id, run.id, sessionID)
  void Bus.publish(LoopEvent.RunStarted, {
    loopID: def.id,
    runID: run.id,
    sessionID,
  })

  let firstError: string | undefined
  if (signal.aborted) {
    firstError = "aborted before stages ran"
  } else {
    // `prompt.command` has no abort-signal input; the only cancellation
    // primitive is `prompt.cancel(sessionID)`. Bridge the run's signal to it
    // so a cancel/timeout actually stops the in-flight stage instead of
    // waiting for it to finish on its own.
    const onAbort = () => {
      promptCancel(sessionID, sandbox?.directory).catch((error) =>
        log.warn("session cancel on abort failed", {
          sessionID,
          error: describeError(error),
        }),
      )
    }
    signal.addEventListener("abort", onAbort, { once: true })
    try {
      for (const stage of def.stages) {
        if (signal.aborted) {
          firstError = "aborted"
          break
        }
        const result = await (stageExecutorOverride ?? executeStage)(
          def,
          stage,
          sessionID,
          signal,
          sandbox?.directory,
        )
        if (!result.ok) {
          firstError = result.error ?? `Stage "${stage.name}" failed`
          break
        }
      }
    } finally {
      signal.removeEventListener("abort", onAbort)
    }
  }

  const endedAt = Date.now()
  const timedOut = signal.aborted && signal.reason === "timeout"
  if (timedOut) firstError = "Run timed out"
  const ok = firstError === undefined && !signal.aborted
  const finalStatus: LoopRunStatus = timedOut ? "timeout" : signal.aborted ? "cancelled" : ok ? "complete" : "error"
  await Manager.finishRun(def.id, run.id, {
    status: finalStatus,
    ok,
    endedAt,
    ...(firstError !== undefined ? { error: firstError } : {}),
  })

  // Best-effort auto-PR: when the run completed cleanly and the definition
  // opted in, push the worktree to a stable loop branch and create/update a
  // GitHub PR. The function never throws, so a missing git/gh/auth or a
  // pre-existing failing push just leaves the run at `status: "complete"`
  // without a `pullRequest` field on the record.
  let pullRequest: LoopPullRequestRef | undefined
  if (ok && def.createPR) {
    const completedRun: LoopRun = {
      ...run,
      status: finalStatus,
      ok,
      endedAt,
      sessionID,
    }
    try {
      const hook = prHookOverride ?? PR.createLoopPullRequest
      // Push from wherever the work actually happened: the sandbox worktree
      // when there is one, the host checkout otherwise.
      pullRequest = await hook({
        def,
        run: completedRun,
        ...(sandbox ? { directory: sandbox.directory, branch: sandbox.branch } : {}),
      })
    } catch (error) {
      log.warn("auto PR hook threw", {
        loopID: def.id,
        runID: run.id,
        error: describeError(error),
      })
    }
    if (pullRequest) {
      await Manager.attachRunPullRequest(def.id, run.id, pullRequest)
    }
  }

  void Bus.publish(LoopEvent.RunFinished, {
    loopID: def.id,
    runID: run.id,
    sessionID,
    status: finalStatus,
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
  } else if (finalStatus === "cancelled") {
    patch(def.id, (prev) => ({
      ...prev,
      status: "idle",
      lastError: firstError,
    }))
  } else {
    // "error" and "timeout" both surface as an error runtime. Keep the
    // session on timeout so the user can inspect the partial work.
    patch(def.id, (prev) => ({
      ...prev,
      status: "error",
      lastError: firstError,
      ...(timedOut ? {} : { sessionID: undefined }),
    }))
  }
  return { ok, firstError, sessionID }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run a loop once. Returns immediately if a run is already in flight for this
 * loop, or if global concurrency is at capacity. Errors are caught and surfaced
 * via Bus + Runtime state.
 *
 * Concurrency safety: the single-flight slot is **claimed synchronously** before
 * any await, so two concurrent `runOnce(id)` calls (e.g. timer + manual button)
 * can never both pass the `inFlight.has` guard. The first call replaces the
 * placeholder with a real promise; the second call returns the same promise.
 */
export async function runOnce(id: string): Promise<void> {
  const { inFlight } = instanceState()
  // ── Synchronous claim ──────────────────────────────────────────────────────
  const existing = inFlight.get(id)
  if (existing) {
    return
  }
  const ctrl = new AbortController()
  const slot: InFlightRun = {
    controller: ctrl,
    promise: Promise.resolve(),
  }
  inFlight.set(id, slot)
  let timeout: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  try {
    // ── Capacity check (synchronous, right after the claim) ──────────────────
    // Counting claimed slots instead of "running" runtimes keeps the check
    // race-free: runtime status only flips to "running" inside executeRun,
    // after several awaits. The count includes this call's own slot, hence
    // the strict `>`. Slots claimed by runs that bail on the guards below
    // inflate the count for a few ms; that's acceptable.
    if (inFlight.size > MAX_CONCURRENT_RUNS) {
      log.info("max concurrent runs reached; skipping", { id })
      void Bus.publish(LoopEvent.Aborted, { loopID: id, reason: "capacity" })
      return
    }
    const def = await Manager.get(id)
    if (!def) {
      log.warn("runOnce called for unknown loop", { id })
      return
    }
    if (!def.enabled) return
    if (def.paused || runtimeOf(id).status === "paused") return

    // Enforce maxRuns before kicking off a new run.
    if (def.maxRuns !== undefined) {
      const runs = await Manager.countRuns(id)
      if (runs >= def.maxRuns) {
        log.info("loop reached maxRuns; disarming", {
          id,
          maxRuns: def.maxRuns,
        })
        patch(id, (prev) => ({ ...prev, status: "idle" }))
        Scheduler.unregister(schedulerID(id))
        void Manager.setEnabled(id, false).catch(() => {})
        return
      }
    }

    const latest = await Manager.get(id)
    if (!latest) {
      log.warn("loop removed before run could start", { id })
      return
    }

    // Materialize the sandbox before the run record exists: a failure here is
    // non-fatal (RunSandbox.ensure never throws) and just means the run
    // executes in the host directory.
    const sandbox = await ensureSandbox(def)
    slot.directory = sandbox?.directory

    const run = await Manager.startRun(id)
    slot.runID = run.id

    // Cap the run's wall-clock time so a hung stage can never hold the
    // single-flight slot forever. The "timeout" reason lets executeRun
    // distinguish this abort from a user cancel.
    const timeoutMs = Math.min(
      Math.max(def.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS, MIN_RUN_TIMEOUT_MS),
      MAX_RUN_TIMEOUT_MS,
    )
    timeout = setTimeout(() => ctrl.abort("timeout"), timeoutMs)
    // Renew the run's lease while we drive it, so restore() in another
    // process doesn't orphan a legitimately running run.
    heartbeat = setInterval(() => void Manager.touchRun(id, run.id), Math.floor(LOOP_RUN_LEASE_MS / 3))

    // Swap the placeholder for the real promise so subsequent calls await it.
    const real = (async () => {
      try {
        await executeRun(
          def,
          run,
          ctrl.signal,
          (sessionID) => {
            slot.sessionID = sessionID
          },
          sandbox,
        )
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
      }
    })()
    slot.promise = real
    await real
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (heartbeat !== undefined) clearInterval(heartbeat)
    inFlight.delete(id)
  }
}

/**
 * Abort an in-flight run for a loop. Returns the in-flight promise (so the
 * caller can await its completion) or `undefined` if nothing is running.
 *
 * The DELETE route calls this *before* `Manager.remove` so that no orphan
 * `LoopRun` is written for a loop the user just deleted.
 */
export function abort(id: string): Promise<void> | undefined {
  return instanceState().inFlight.get(id)?.promise
}

/** Cancel + finalize any in-flight run for a loop. Used by the DELETE route. */
export async function cancelRun(id: string): Promise<void> {
  const slot = instanceState().inFlight.get(id)
  if (!slot) return
  const runID = slot.runID
  const sessionID = slot.sessionID ?? runtimeOf(id).sessionID
  patch(id, (prev) => ({ ...prev, status: "cancelling" }))
  await cancelInFlightRun(id, runID, sessionID)
  if (runID) {
    await Manager.finishRun(id, runID, {
      status: "cancelled",
      ok: false,
      endedAt: Date.now(),
      error: "Cancelled by user",
    })
  }
  void Bus.publish(LoopEvent.Aborted, {
    loopID: id,
    ...(runID ? { runID } : {}),
    reason: "user-cancel",
  })
  // Wait for the in-flight promise to settle.
  try {
    await slot.promise
  } catch {
    // best-effort
  }
  patch(id, (prev) => ({ ...prev, status: "idle" }))
}

// ── Scheduler arming ─────────────────────────────────────────────────────────

function schedulerID(id: string): string {
  return `loop:${id}`
}

/** Register (or re-register) the interval trigger for one loop. */
export function arm(def: LoopDefinition): void {
  Scheduler.unregister(schedulerID(def.id))
  if (!def.enabled || def.paused || def.trigger.kind !== "interval") return
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

/**
 * Re-arm all enabled interval loops for this instance, AND rehydrate the live
 * `Runtime` map from the latest persisted run, AND reconcile any stale
 * `"running"` runs (process died mid-run). Call from `InstanceBootstrap`.
 */
export async function restore(): Promise<void> {
  const defs = await Manager.list()
  for (const def of defs) {
    arm(def)
    const status: RuntimeStatus = def.paused ? "paused" : "idle"
    // Rehydrate runtime state from the latest run (if any).
    const recent = await Manager.listRuns(def.id, 1)
    if (recent.length > 0) {
      const last = recent[0]
      const rehydrated: Runtime = {
        status,
        runs: await Manager.countRuns(def.id),
        lastRunAt: last.endedAt ?? last.startedAt,
        ...(last.error ? { lastError: last.error } : {}),
        ...(last.sessionID ? { sessionID: last.sessionID } : {}),
      }
      instanceState().live.set(def.id, rehydrated)
    } else if (def.paused) {
      patch(def.id, (prev) => ({ ...prev, status: "paused" }))
    }
  }

  // Reconcile stale "running" runs (orphaned by a previous process exit).
  // The lease is judged on the heartbeat, not startedAt, so a long run that
  // is still actively driven (heartbeats every LOOP_RUN_LEASE_MS / 3) is
  // never orphaned from under its owner.
  const stale = await Manager.listRunningRuns()
  const cutoff = Date.now() - LOOP_RUN_LEASE_MS
  const isExpired = (run: LoopRun) => (run.heartbeatAt ?? run.startedAt) < cutoff
  for (const run of stale) {
    if (isExpired(run)) {
      log.warn("orphaning stale run", { loopID: run.loopID, runID: run.id })
      await Manager.orphanRun(run.loopID, run.id)
      void Bus.publish(LoopEvent.RunFinished, {
        loopID: run.loopID,
        runID: run.id,
        sessionID: run.sessionID,
        status: "orphaned",
        ok: false,
        error: "Process exited before the run finished",
      })
    }
  }

  log.info("restored loops", {
    count: defs.length,
    armed: defs.filter((d) => d.enabled && !d.paused && d.trigger.kind === "interval").length,
    orphaned: stale.filter(isExpired).length,
  })
}

/**
 * Surgical sync: arm/disarm a single loop based on its current state. Cheaper
 * than `restore()` for write paths.
 */
export async function sync(id: string): Promise<void> {
  const def = await Manager.get(id)
  if (def) arm(def)
  else disarm(id)
}

/** Drop all timers + per-instance state. (Instance disposal hook.) */
export function dispose(): void {
  const { inFlight, live } = instanceState()
  for (const slot of inFlight.values()) slot.controller.abort()
  inFlight.clear()
  live.clear()
}

// ── Reactive read-only accessors (for routes + TUI) ─────────────────────────

export function getRuntime(id: string): Runtime {
  return runtimeOf(id)
}

export function listRuntimes(): Array<{ loopID: string; runtime: Runtime }> {
  return Array.from(instanceState().live.entries()).map(([loopID, runtime]) => ({ loopID, runtime }))
}

/** Reset the run counter (persisted + in-memory) for a loop. Used after manual run cap edits. */
export async function resetRunCount(id: string): Promise<void> {
  await Manager.resetRunCounter(id)
  patch(id, (prev) => ({ ...prev, runs: 0 }))
}

/** Public mutator for the runtime status. Used by pause/resume routes. */
export function setRuntimeStatus(id: string, status: RuntimeStatus): void {
  patch(id, (prev) => ({ ...prev, status }))
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
