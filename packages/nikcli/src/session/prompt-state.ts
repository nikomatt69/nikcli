import { Context, Effect, Layer, ScopedCache } from "effect"
import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import { SessionStatus } from "./status"
import { InstanceState, runtimeFor, runPromiseWithLayer, withCurrentInstance } from "@/effect"

export namespace PromptState {
  const log = Log.create({ service: "session.prompt" })

  export type Entry = {
    abort: AbortController
    cancelling?: boolean
    callbacks: {
      resolve(input: MessageV2.WithParts): void
      reject(error?: Error): void
    }[]
  }
  export type State = Record<string, Entry>

  /**
   * Every session this **process** is currently running, across instances.
   *
   * `State` is instance-scoped, which is right for ownership but wrong for the
   * shutdown question: "what is this process running?" has no instance to ask
   * it in. Session ids are globally unique, so a flat process-level set is the
   * honest model — and it matches the scope of what a graceful shutdown can
   * promise. See `specs/v2/session-restart-continuation.md`.
   */
  const active = new Set<string>()

  export function activeSessions(): string[] {
    return [...active]
  }

  function interrupted() {
    return Effect.tryPromise({
      try: () => Promise.resolve(new MessageV2.AbortedError({ message: "Session interrupted" })),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
  }

  function rejectWaiters(callbacks: Entry["callbacks"]) {
    return Effect.gen(function* () {
      const error = yield* interrupted()
      for (const callback of callbacks) {
        yield* Effect.promise(() => Promise.resolve(callback.reject(error)))
      }
    })
  }

  function setStatus(sessionID: string, status: SessionStatus.Info) {
    return runPromiseWithLayer(
      SessionStatus.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const sessionStatus = yield* SessionStatus.Service
          return yield* sessionStatus.set(sessionID, status)
        }),
      ),
    )
  }

  export class Cache extends Context.Service<Cache, ScopedCache.ScopedCache<string, State>>()(
    "SessionPrompt.StateCache",
  ) {}

  export const layer = Layer.effect(
    Cache,
    InstanceState.make<State>(() =>
      Effect.gen(function* () {
        const data: State = {}
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const [sessionID, item] of Object.entries(data)) {
              if (!item.abort.signal.aborted) item.abort.abort()
              if (!item.cancelling) {
                item.cancelling = true
                yield* Effect.orDie(rejectWaiters(item.callbacks))
                item.callbacks = []
              }
              active.delete(sessionID)
            }
          }),
        )
        return data
      }),
    ),
  )

  function stateEffect() {
    return Effect.gen(function* () {
      const cache = yield* Cache
      return yield* InstanceState.get(cache)
    })
  }

  export function getServiceStateEffect() {
    return stateEffect().pipe(Effect.provide(layer))
  }

  export function state(): State {
    return runtimeFor(layer).runSync(withCurrentInstance(stateEffect()))
  }

  /**
   * Reserve a session in the state map and return its AbortController so the
   * model loop can listen for cancellation. When the session is already
   * running, returns undefined and the caller should queue instead.
   */
  export function start(sessionID: string) {
    const s = state()
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
    }
    active.add(sessionID)
    return controller
  }

  /**
   * Tear down a session entry created by `start` if the controller still owns
   * it. Sets the session status back to idle, rejects pending waiters, and
   * drops the entry from the state map.
   */
  export async function finish(sessionID: string, controller: AbortController) {
    const s = state()
    const match = s[sessionID]
    if (!match || match.abort !== controller) return
    if (!match.cancelling) {
      match.cancelling = true
      rejectWaiters(match.callbacks)
      match.callbacks = []
    }
    await setStatus(sessionID, { type: "idle" })
    if (s[sessionID] === match) {
      delete s[sessionID]
    }
    active.delete(sessionID)
  }

  /** Abort an active session (or clear a stale "busy" status if none is recorded). */
  export const cancel = (() => {
    return async function cancel(sessionID: string) {
      log.info("cancel", { sessionID })
      const s = state()
      const match = s[sessionID]
      if (!match) {
        await setStatus(sessionID, { type: "idle" })
        return
      }
      if (!match.abort.signal.aborted) {
        match.abort.abort()
      }
      if (match.cancelling) {
        await rejectWaiters(match.callbacks)
      } else {
        match.cancelling = true
        rejectWaiters(match.callbacks)
        match.callbacks = []
      }
      // A cancelled turn must not be offered to the next server. `finish`
      // also deletes; Set.delete is idempotent, so both paths are safe.
      active.delete(sessionID)
      await setStatus(sessionID, { type: "idle" })
    }
  })()
}
