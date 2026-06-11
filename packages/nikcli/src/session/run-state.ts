import { Context, Effect, Layer, Schema } from "effect"
import { Busy, make as makeRunner, type Runner } from "./runner"
import { SessionStatus } from "./status"

/**
 * SessionRunState — per-sessionID Runner registry.
 *
 * Each sessionID gets at most one Runner. The Runner enforces single-flight on
 * normal `ensureRunning` work and at-most-one shell with an optional queued run
 * (ShellThenRun). Calling `cancel(sessionID)` interrupts the active fiber and
 * yields the `onInterrupt` value.
 *
 * Drop-in companion to the bare `runner.ts` module. Mirrors opencode's
 * session/run-state.ts shape so the call sites in session/processor.ts can
 * adopt it incrementally.
 */
export namespace SessionRunState {
  export class BusyError extends Schema.TaggedErrorClass<BusyError>()("SessionBusyError", {
    sessionID: Schema.String,
  }) {
    override get message() {
      return `Session ${this.sessionID} is busy`
    }
  }

  export interface Interface {
    readonly assertNotBusy: (sessionID: string) => Effect.Effect<void, BusyError>
    readonly cancel: (sessionID: string) => Effect.Effect<void>
    readonly ensureRunning: <A, E>(
      sessionID: string,
      onInterrupt: Effect.Effect<A>,
      work: Effect.Effect<A, E>,
    ) => Effect.Effect<A, E>
    readonly startShell: <A, E>(
      sessionID: string,
      onInterrupt: Effect.Effect<A>,
      work: Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | BusyError>
  }

  export class Service extends Context.Service<Service, Interface>()("SessionRunState.Service") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const status = yield* SessionStatus.Service
      const runners = new Map<string, Runner<unknown, unknown>>()

      yield* Effect.addFinalizer(() =>
        Effect.forEach(runners.values(), (r) => Effect.orDie(r.cancel), {
          concurrency: "unbounded",
          discard: true,
        }).pipe(Effect.tap(() => Effect.sync(() => runners.clear()))),
      )

      // The registry stores type-erased runners (one per sessionID, callers may
      // use different A/E). `onInterrupt` is intentionally NOT bound here: it is
      // per call, so a joining caller always gets its own interrupt value rather
      // than whichever closure happened to create the runner first.
      const get = (sessionID: string) => {
        const existing = runners.get(sessionID)
        if (existing) return existing
        const runner = makeRunner<unknown, unknown>(scope, {
          onIdle: status
            .set(sessionID, { type: "idle" })
            .pipe(Effect.tap(() => Effect.sync(() => runners.delete(sessionID)))),
          onBusy: status.set(sessionID, {
            type: "busy",
            since: Date.now(),
          } as SessionStatus.Info),
        })
        runners.set(sessionID, runner)
        return runner
      }

      const assertNotBusy = (sessionID: string): Effect.Effect<void, BusyError> =>
        Effect.suspend(() => {
          const existing = runners.get(sessionID)
          if (existing?.busy) return Effect.fail(new BusyError({ sessionID }))
          return Effect.void
        })

      const cancel = (sessionID: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const existing = runners.get(sessionID)
          if (!existing || !existing.busy) {
            yield* status.set(sessionID, { type: "idle" })
            return
          }
          yield* existing.cancel
        })

      const ensureRunning = <A, E>(
        sessionID: string,
        onInterrupt: Effect.Effect<A>,
        work: Effect.Effect<A, E>,
      ): Effect.Effect<A, E> =>
        Effect.suspend(() => {
          const runner = get(sessionID)
          return runner.ensureRunning(
            work as Effect.Effect<unknown, unknown>,
            onInterrupt as Effect.Effect<unknown, unknown>,
          ) as Effect.Effect<A, E>
        })

      const startShell = <A, E>(
        sessionID: string,
        onInterrupt: Effect.Effect<A>,
        work: Effect.Effect<A, E>,
      ): Effect.Effect<A, E | BusyError> =>
        Effect.suspend(() => {
          const runner = get(sessionID)
          return runner
            .startShell(
              work as Effect.Effect<unknown, unknown>,
              undefined,
              onInterrupt as Effect.Effect<unknown, unknown>,
            )
            .pipe(
              Effect.mapError((e: unknown) => (e instanceof Busy ? new BusyError({ sessionID }) : (e as E))),
            ) as Effect.Effect<A, E | BusyError>
        })

      return Service.of({
        assertNotBusy,
        cancel,
        ensureRunning,
        startShell,
      })
    }),
  )

  export const defaultLayer = Layer.provideMerge(layer, SessionStatus.defaultLayer)
}

// Re-export for ergonomics
export { Busy as RunnerBusy } from "./runner"
