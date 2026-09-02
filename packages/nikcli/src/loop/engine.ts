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
import { Log } from "@nikcli-ai/util/log"
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
import { InstanceState, type InstanceContext } from "@/effect"

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
  /**
   * Emitted when the engine refuses to start a run (or aborts one in flight).
   *
   * Internal: no subscriber, and the client-visible consequence already arrives
   * as `loop.run.finished` / `loop.runtime.changed`. This one carries the
   * engine's private reason (`"capacity"`, `"user-pause"`), which is scheduling
   * detail, not conversation state. See `specs/v2/public-event-filter.md`.
   */
  Aborted: BusEvent.schema(
    "loop.aborted",
    Schema.Struct({
      loopID: Schema.String,
      runID: Schema.optional(Schema.String),
      reason: Schema.String,
    }),
    { visibility: "internal" },
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
  /** Session that fired `/loop/.../run`. Threaded into every stage prompt so
   * the loop's freshly-created session inherits the caller's model. */
  callerSessionID?: string
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

// Errors surfaced to users arrive as arbitrary thrown values from Effect/catch boundaries;
// decode the `{ message }` shape once here instead of sniffing representations at call sites.
const errorWithMessage = z.object({ message: z.string() })

function describeError<E>(error: E): string {
  if (error instanceof Error) return error.message
  const parsed = errorWithMessage.safeParse(error)
  if (parsed.success) return parsed.data.message
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
 * the sandbox (the instance directory) instead of the user's checkout.
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
async function ensureSandbox(instance: InstanceContext, def: LoopDefinition): Promise<RunSandbox.Info | undefined> {
  const hostDirectory = instance.directory
  if (!isSandboxed(def)) return undefined
  const sandboxInput: RunSandbox.EnsureInput = {
    hostDirectory,
    name: `loop-${def.name}`,
    branchPrefix: "nikcli/loop",
  }
  if (def.worktree) sandboxInput.existing = def.worktree
  const sandbox = await RunSandbox.ensure(sandboxInput)
  if (sandbox && sandbox.directory !== def.worktree?.directory) {
    await Manager.setWorktree(instance.project.id, def.id, sandbox).catch((error) =>
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
  parentSessionID?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const args = stage.tokenBudget ? `${stage.objective} --token-budget ${stage.tokenBudget}` : stage.objective
    const input: SessionPrompt.CommandInput = {
      sessionID,
      command: "goal",
      arguments: args,
      agent: stage.agent || DEFAULT_LOOP_AGENT,
    }
    if (stage.model) input.model = stage.model
    if (parentSessionID) input.parentSessionID = parentSessionID
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
        // A loop has nobody to answer a permission prompt. Granting full
        // access is only defensible because the run is confined to its own
        // worktree; un-sandboxed loops keep the ordinary rules.
        const input: Session.CreateInput = { title }
        if (sandboxed) input.permission = PermissionNext.fullAccess()
        return yield* service.create(input)
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
  instance: InstanceContext,
  def: LoopDefinition,
  run: LoopRun,
  signal: AbortSignal,
  onSessionID?: (sessionID: string) => void,
  sandbox?: RunSandbox.Info,
  parentSessionID?: string,
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

  await Manager.attachRunSession(instance.project.id, def.id, run.id, sessionID)
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
          parentSessionID,
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
  const finishPatch: Parameters<typeof Manager.finishRun>[3] = {
    status: finalStatus,
    ok,
    endedAt,
  }
  if (firstError !== undefined) finishPatch.error = firstError
  await Manager.finishRun(instance.project.id, def.id, run.id, finishPatch)

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
      const hookOptions: PR.CreatePullRequestOptions = {
        instance,
        def,
        run: completedRun,
      }
      if (sandbox) {
        hookOptions.directory = sandbox.directory
        hookOptions.branch = sandbox.branch
      }
      pullRequest = await hook(hookOptions)
    } catch (error) {
      log.warn("auto PR hook threw", {
        loopID: def.id,
        runID: run.id,
        error: describeError(error),
      })
    }
    if (pullRequest) {
      await Manager.attachRunPullRequest(instance.project.id, def.id, run.id, pullRequest)
    }
  }

  void Bus.publish(LoopEvent.RunFinished, {
    loopID: def.id,
    runID: run.id,
    sessionID,
    status: finalStatus,
    ok,
    ...(firstError !== undefined ? { error: firstError } : undefined),
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
    patch(def.id, (prev) => {
      const next: Runtime = {
        ...prev,
        status: "error",
        lastError: firstError,
      }
      if (!timedOut) next.sessionID = undefined
      return next
    })
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
export async function runOnce(id: string, options?: { callerSessionID?: string }): Promise<void> {
  const instance = InstanceState.ambient()
  const callerSessionID = options?.callerSessionID
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
  if (callerSessionID) slot.callerSessionID = callerSessionID
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
    const def = await Manager.get(instance.project.id, id)
    if (!def) {
      log.warn("runOnce called for unknown loop", { id })
      return
    }
    if (!def.enabled) return
    if (def.paused || runtimeOf(id).status === "paused") return

    // Enforce maxRuns before kicking off a new run.
    if (def.maxRuns !== undefined) {
      const runs = await Manager.countRuns(instance.project.id, id)
      if (runs >= def.maxRuns) {
        log.info("loop reached maxRuns; disarming", {
          id,
          maxRuns: def.maxRuns,
        })
        patch(id, (prev) => ({ ...prev, status: "idle" }))
        Scheduler.unregister(schedulerID(id))
        // Awaited: `runOnce` is the call that disarms the loop, so a caller that
        // awaits it should be able to read the disabled definition back. Left as
        // fire-and-forget, the persistence raced the return and the loop still
        // read as enabled immediately afterwards — reliably on a slower
        // filesystem. Failures stay swallowed: the in-memory state and the
        // scheduler are already updated above, and a storage error should not
        // turn a completed cap into a thrown tick.
        await Manager.setEnabled(instance.project.id, id, false).catch(() => {})
        return
      }
    }

    const latest = await Manager.get(instance.project.id, id)
    if (!latest) {
      log.warn("loop removed before run could start", { id })
      return
    }

    // Materialize the sandbox before the run record exists: a failure here is
    // non-fatal (RunSandbox.ensure never throws) and just means the run
    // executes in the host directory.
    const sandbox = await ensureSandbox(instance, def)
    slot.directory = sandbox?.directory

    const run = await Manager.startRun(instance.project.id, id)
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
    heartbeat = setInterval(
      () => void Manager.touchRun(instance.project.id, id, run.id),
      Math.floor(LOOP_RUN_LEASE_MS / 3),
    )

    // Swap the placeholder for the real promise so subsequent calls await it.
    const real = (async () => {
      try {
        await executeRun(
          instance,
          def,
          run,
          ctrl.signal,
          (sessionID) => {
            slot.sessionID = sessionID
          },
          sandbox,
          callerSessionID,
        )
      } catch (error) {
        const message = describeError(error)
        log.error("run failed", { id, error: message })
        await Manager.finishRun(instance.project.id, id, run.id, {
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
  const instance = InstanceState.ambient()
  const slot = instanceState().inFlight.get(id)
  if (!slot) return
  const runID = slot.runID
  const sessionID = slot.sessionID ?? runtimeOf(id).sessionID
  patch(id, (prev) => ({ ...prev, status: "cancelling" }))
  await cancelInFlightRun(id, runID, sessionID)
  if (runID) {
    await Manager.finishRun(instance.project.id, id, runID, {
      status: "cancelled",
      ok: false,
      endedAt: Date.now(),
      error: "Cancelled by user",
    })
  }
  void Bus.publish(LoopEvent.Aborted, {
    loopID: id,
    ...(runID ? { runID } : undefined),
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
  // Captured here, not read inside `run`. `Scheduler.run` establishes no
  // instance scope of its own; the task only ever found one because
  // AsyncLocalStorage propagates into a timer created inside the scope.
  const instance = InstanceState.ambient()
  Scheduler.register({
    id: schedulerID(def.id),
    interval: def.trigger.everyMs,
    scope: "instance",
    skipInitialRun: true,
    run: async () => {
      // Re-enter the instance this loop was armed in so Session/SessionPrompt
      // resolve against the right directory.
      await withInstanceAsync({ directory: instance.directory }, () => runOnce(def.id))
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
  const instance = InstanceState.ambient()
  const defs = await Manager.list(instance.project.id)
  for (const def of defs) {
    arm(def)
    const status: RuntimeStatus = def.paused ? "paused" : "idle"
    // Rehydrate runtime state from the latest run (if any).
    const recent = await Manager.listRuns(instance.project.id, def.id, 1)
    if (recent.length > 0) {
      const last = recent[0]
      const rehydrated: Runtime = {
        status,
        runs: await Manager.countRuns(instance.project.id, def.id),
        lastRunAt: last.endedAt ?? last.startedAt,
      }
      if (last.error) rehydrated.lastError = last.error
      if (last.sessionID) rehydrated.sessionID = last.sessionID
      instanceState().live.set(def.id, rehydrated)
    } else if (def.paused) {
      patch(def.id, (prev) => ({ ...prev, status: "paused" }))
    }
  }

  // Reconcile stale "running" runs (orphaned by a previous process exit).
  // The lease is judged on the heartbeat, not startedAt, so a long run that
  // is still actively driven (heartbeats every LOOP_RUN_LEASE_MS / 3) is
  // never orphaned from under its owner.
  const stale = await Manager.listRunningRuns(instance.project.id)
  const cutoff = Date.now() - LOOP_RUN_LEASE_MS
  const isExpired = (run: LoopRun) => (run.heartbeatAt ?? run.startedAt) < cutoff
  for (const run of stale) {
    if (isExpired(run)) {
      log.warn("orphaning stale run", { loopID: run.loopID, runID: run.id })
      await Manager.orphanRun(instance.project.id, run.loopID, run.id)
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
  const instance = InstanceState.ambient()
  const def = await Manager.get(instance.project.id, id)
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
  const instance = InstanceState.ambient()
  await Manager.resetRunCounter(instance.project.id, id)
  patch(id, (prev) => ({ ...prev, runs: 0 }))
}

/** Public mutator for the runtime status. Used by pause/resume routes. */
export function setRuntimeStatus(id: string, status: RuntimeStatus): void {
  patch(id, (prev) => ({ ...prev, status }))
}

/** Test/debug helper: snapshot the engine state for assertions. */
export function _internalSnapshot() {
  const { live, inFlight } = instanceState()
  return {
    live: Array.from(live.entries()),
    inFlight: Array.from(inFlight.keys()),
  }
}
