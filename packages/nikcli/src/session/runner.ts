import { Cause, Deferred, Effect, Exit, Fiber, Latch, Schema, Scope, SynchronizedRef } from "effect"

/**
 * Session lifecycle runner — single-flight state machine for an agent session.
 *
 * States:
 *   Idle               — no work in flight
 *   Running            — a normal `ensureRunning` call is executing
 *   Shell              — a `startShell` (e.g. !command) is executing
 *   ShellThenRun       — a shell is running and a normal run is queued
 *
 * Guarantees:
 *   - At most one shell + at most one run active concurrently
 *   - `cancel` interrupts the active fiber and returns the `onInterrupt` value
 *   - All forks are attached to the provided Scope (cleaned up on dispose)
 *
 * Mirrors opencode's effect/runner.ts.
 */

export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("RunnerCancelled", {}) {}
export class Busy extends Schema.TaggedErrorClass<Busy>()("RunnerBusy", {}) {}

export interface Runner<A, E = never> {
  readonly state: State<A, E>
  readonly busy: boolean
  readonly ensureRunning: (work: Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly startShell: (work: Effect.Effect<A, E>, ready?: Latch.Latch) => Effect.Effect<A, E | Busy>
  readonly cancel: Effect.Effect<void>
}

interface RunHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | Cancelled>
  fiber: Fiber.Fiber<unknown, unknown>
}

interface ShellHandle {
  id: number
  cancelled: Deferred.Deferred<void>
  ready?: Latch.Latch
  fiber: Fiber.Fiber<unknown, unknown>
}

interface PendingHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | Cancelled>
  work: Effect.Effect<A, E>
}

export type State<A, E> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running"; readonly run: RunHandle<A, E> }
  | { readonly _tag: "Shell"; readonly shell: ShellHandle }
  | { readonly _tag: "ShellThenRun"; readonly shell: ShellHandle; readonly run: PendingHandle<A, E> }

export const make = <A, E = never>(
  scope: Scope.Scope,
  opts?: {
    onIdle?: Effect.Effect<void>
    onBusy?: Effect.Effect<void>
    onInterrupt?: Effect.Effect<A, E>
  },
): Runner<A, E> => {
  const ref = SynchronizedRef.makeUnsafe<State<A, E>>({ _tag: "Idle" })
  const idle = opts?.onIdle ?? Effect.void
  const onBusy = opts?.onBusy ?? Effect.void
  const onInterrupt = opts?.onInterrupt
  let ids = 0

  const state = () => SynchronizedRef.getUnsafe(ref)
  const next = () => {
    ids += 1
    return ids
  }

  const complete = (done: Deferred.Deferred<A, E | Cancelled>, exit: Exit.Exit<A, E>) =>
    Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
      ? Deferred.fail(done, new Cancelled()).pipe(Effect.asVoid)
      : Deferred.done(done, exit).pipe(Effect.asVoid)

  const awaitDone = (done: Deferred.Deferred<A, E | Cancelled>) =>
    Deferred.await(done).pipe(Effect.catchTag("RunnerCancelled", (e) => onInterrupt ?? Effect.die(e)))

  const idleIfCurrent = () =>
    SynchronizedRef.modify(ref, (st) => [st._tag === "Idle" ? idle : Effect.void, st] as const).pipe(Effect.flatten)

  const finishRun = (id: number, done: Deferred.Deferred<A, E | Cancelled>, exit: Exit.Exit<A, E>) =>
    SynchronizedRef.modify(
      ref,
      (st) =>
        [
          Effect.gen(function* () {
            if (st._tag === "Running" && st.run.id === id) yield* idle
            yield* complete(done, exit)
          }),
          st._tag === "Running" && st.run.id === id ? ({ _tag: "Idle" } as const) : st,
        ] as const,
    ).pipe(Effect.flatten)

  const finishShell = (id: number, _exit: Exit.Exit<A, E>) =>
    SynchronizedRef.modify(ref, (st) => {
      if ((st._tag === "Shell" || st._tag === "ShellThenRun") && st.shell.id === id) {
        if (st._tag === "Shell") {
          return [idle, { _tag: "Idle" } as const] as const
        }
        // ShellThenRun: promote pending run to running
        const pending = st.run
        return [
          Effect.gen(function* () {
            yield* onBusy
            const fiber = yield* Effect.forkIn(scope)(
              Effect.matchCauseEffect(pending.work, {
                onFailure: (cause) => finishRun(pending.id, pending.done, Exit.failCause(cause)),
                onSuccess: (value) => finishRun(pending.id, pending.done, Exit.succeed(value)),
              }),
            )
            yield* SynchronizedRef.update(ref, () => ({
              _tag: "Running" as const,
              run: { id: pending.id, done: pending.done, fiber },
            }))
          }),
          st,
        ] as const
      }
      return [Effect.void, st] as const
    }).pipe(Effect.flatten)

  const ensureRunning = (work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.gen(function* () {
      const current = state()
      // If already running, await its completion (treat as join)
      if (current._tag === "Running") {
        return yield* awaitDone(current.run.done)
      }
      const id = next()
      const done = yield* Deferred.make<A, E | Cancelled>()
      if (current._tag === "Shell") {
        // Queue behind shell
        yield* SynchronizedRef.set(ref, {
          _tag: "ShellThenRun",
          shell: current.shell,
          run: { id, done, work },
        })
        return yield* awaitDone(done)
      }
      if (current._tag === "ShellThenRun") {
        // Already queued; replace queued work? For safety just await existing.
        return yield* awaitDone(current.run.done)
      }
      // Idle: start immediately
      yield* onBusy
      const fiber = yield* Effect.forkIn(scope)(
        Effect.matchCauseEffect(work, {
          onFailure: (cause) => finishRun(id, done, Exit.failCause(cause)),
          onSuccess: (value) => finishRun(id, done, Exit.succeed(value)),
        }),
      )
      yield* SynchronizedRef.set(ref, { _tag: "Running", run: { id, done, fiber } })
      return yield* awaitDone(done)
    })

  const startShell = (work: Effect.Effect<A, E>, ready?: Latch.Latch): Effect.Effect<A, E | Busy> =>
    Effect.gen(function* () {
      const current = state()
      if (current._tag !== "Idle") {
        return yield* Effect.fail(new Busy())
      }
      const id = next()
      const cancelled = yield* Deferred.make<void>()
      yield* onBusy
      const fiber = yield* Effect.forkIn(scope)(work)
      yield* SynchronizedRef.set(ref, {
        _tag: "Shell",
        shell: { id, cancelled, ready, fiber },
      })
      const exit = yield* Fiber.await(fiber)
      yield* finishShell(id, exit as Exit.Exit<A, E>)
      return yield* (exit as Exit.Exit<A, E>)
    })

  const cancel: Effect.Effect<void> = Effect.gen(function* () {
    const current = state()
    if (current._tag === "Idle") return
    if (current._tag === "Running") {
      yield* Fiber.interrupt(current.run.fiber)
      return
    }
    if (current._tag === "Shell") {
      yield* Deferred.succeed(current.shell.cancelled, void 0)
      yield* Fiber.interrupt(current.shell.fiber)
      return
    }
    if (current._tag === "ShellThenRun") {
      // Drop the queued run, interrupt the shell
      yield* Deferred.fail(current.run.done, new Cancelled())
      yield* Deferred.succeed(current.shell.cancelled, void 0)
      yield* Fiber.interrupt(current.shell.fiber)
      yield* SynchronizedRef.set(ref, { _tag: "Idle" })
      return
    }
  })

  return {
    get state() {
      return state()
    },
    get busy() {
      return state()._tag !== "Idle"
    },
    ensureRunning,
    startShell,
    cancel,
  }
}
