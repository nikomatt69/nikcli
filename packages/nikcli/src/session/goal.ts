import { Context, Effect, Layer } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { runPromiseWithLayer } from "@/effect"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"

export namespace SessionGoal {
  export const MAX_ITERATIONS = 50

  export const StatusSchema = z.enum(["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"])
  export type Status = z.infer<typeof StatusSchema>

  export const StateSchema = z
    .object({
      sessionID: z.string(),
      goalID: z.string(),
      objective: z.string(),
      status: StatusSchema,
      tokenBudget: z.number().optional(),
      tokensUsed: z.number(),
      timeUsedSeconds: z.number(),
      iterationCount: z.number(),
      timeCreated: z.number(),
      timeUpdated: z.number(),
    })
    .meta({ ref: "SessionGoalState" })
  export type State = z.infer<typeof StateSchema>

  /** Broadcast whenever a session's goal state is created, updated, or cleared. */
  export const Event = {
    Updated: BusEvent.define(
      "session.goal",
      z.object({
        sessionID: z.string(),
        goal: StateSchema.nullable(),
      }),
    ),
  }

  export type ParsedArguments =
    | { type: "subcommand"; command: "pause" | "resume" | "clear" | "status" }
    | { type: "objective"; objective: string; tokenBudget?: number }

  export interface Interface {
    readonly get: (sessionID: string) => Effect.Effect<State | undefined, unknown>
    readonly set: (sessionID: string, objective: string, tokenBudget?: number) => Effect.Effect<State, unknown>
    readonly updateStatus: (sessionID: string, status: Status) => Effect.Effect<State | undefined, unknown>
    readonly accountUsage: (
      sessionID: string,
      tokensDelta: number,
      timeDeltaSeconds: number,
    ) => Effect.Effect<State | undefined, unknown>
    readonly incrementIteration: (sessionID: string) => Effect.Effect<State | undefined, unknown>
    readonly pause: (sessionID: string) => Effect.Effect<State | undefined, unknown>
    readonly resume: (sessionID: string) => Effect.Effect<State | undefined, unknown>
    readonly usageLimit: (sessionID: string) => Effect.Effect<State | undefined, unknown>
    readonly clear: (sessionID: string) => Effect.Effect<void, unknown>
    readonly isGoalContinueNeeded: (state: State) => boolean
    readonly isIterationLimitReached: (state: State) => boolean
    readonly continuationPrompt: (state: State) => string
    readonly budgetLimitPrompt: (state: State) => string
    readonly iterationLimitPrompt: (state: State) => string
  }

  export class Service extends Context.Service<Service, Interface>()("SessionGoal.Service") {}

  function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
    return runPromiseWithLayer(Storage.defaultLayer, effect)
  }

  function key(sessionID: string) {
    return ["goal", sessionID]
  }

  function storageRead<T>(storageKey: string[]) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.read<T>(storageKey)
      }),
    )
  }

  function storageWrite<T>(storageKey: string[], content: T) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.write(storageKey, content)
      }),
    )
  }

  function storageRemove(storageKey: string[]) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.remove(storageKey)
      }),
    )
  }

  function storageUpdate<T>(storageKey: string[], fn: (draft: T) => void) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.update(storageKey, fn)
      }),
    )
  }

  function isStorageNotFound(error: unknown): boolean {
    if (error instanceof Storage.NotFoundError) return true
    if (typeof error !== "object" || error === null) return false
    const tagged = error as { _tag?: string; cause?: unknown; message?: string }
    return (
      tagged._tag === "NotFoundError" ||
      isStorageNotFound(tagged.cause) ||
      tagged.message?.startsWith("Resource not found:") === true
    )
  }

  function publishGoal(sessionID: string, state: State | undefined) {
    void Bus.publish(Event.Updated, { sessionID, goal: state ?? null })
  }

  async function getImpl(sessionID: string) {
    return storageRead<State>(key(sessionID)).catch((error) => {
      if (isStorageNotFound(error)) return undefined
      throw error
    })
  }

  async function setImpl(sessionID: string, objective: string, tokenBudget?: number) {
    const now = Date.now()
    const state: State = {
      sessionID,
      goalID: Identifier.ascending("goal"),
      objective,
      status: "active",
      ...(tokenBudget !== undefined && { tokenBudget }),
      tokensUsed: 0,
      timeUsedSeconds: 0,
      iterationCount: 0,
      timeCreated: now,
      timeUpdated: now,
    }
    await storageWrite(key(sessionID), state)
    publishGoal(sessionID, state)
    return state
  }

  async function updateStatusImpl(sessionID: string, status: Status) {
    const existing = await getImpl(sessionID)
    if (!existing) return undefined
    const updated = await storageUpdate<State>(key(sessionID), (draft) => {
      draft.status = status
      draft.timeUpdated = Date.now()
    })
    publishGoal(sessionID, updated)
    return updated
  }

  async function accountUsageImpl(sessionID: string, tokensDelta: number, timeDeltaSeconds: number) {
    const existing = await getImpl(sessionID)
    if (!existing) return undefined
    const updated = await storageUpdate<State>(key(sessionID), (draft) => {
      draft.tokensUsed += Math.max(0, Math.floor(tokensDelta))
      draft.timeUsedSeconds += Math.max(0, Math.floor(timeDeltaSeconds))
      if (draft.status === "active" && draft.tokenBudget !== undefined && draft.tokensUsed >= draft.tokenBudget) {
        draft.status = "budget_limited"
      }
      draft.timeUpdated = Date.now()
    })
    publishGoal(sessionID, updated)
    return updated
  }

  async function incrementIterationImpl(sessionID: string) {
    const existing = await getImpl(sessionID)
    if (!existing) return undefined
    const updated = await storageUpdate<State>(key(sessionID), (draft) => {
      draft.iterationCount += 1
      draft.timeUpdated = Date.now()
    })
    publishGoal(sessionID, updated)
    return updated
  }

  async function clearImpl(sessionID: string) {
    await storageRemove(key(sessionID)).catch(() => undefined)
    publishGoal(sessionID, undefined)
  }

  function isGoalContinueNeeded(state: State) {
    return state.status === "active" || state.status === "budget_limited"
  }

  function isIterationLimitReached(state: State) {
    return state.iterationCount >= MAX_ITERATIONS
  }

  function usageLine(state: State) {
    return state.tokenBudget === undefined
      ? `Tokens used: ${state.tokensUsed}`
      : `Tokens used: ${state.tokensUsed} / ${state.tokenBudget}`
  }

  export function formatDuration(seconds: number) {
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
  }

  function continuationPrompt(state: State) {
    return [
      "Continue working toward the active goal.",
      "",
      "<objective>",
      state.objective,
      "</objective>",
      "",
      `Iteration: ${state.iterationCount} / ${MAX_ITERATIONS}`,
      usageLine(state),
      `Time used: ${formatDuration(state.timeUsedSeconds)}`,
      "",
      'Use get_goal if you need the current state. Call update_goal with status "complete" only after current evidence proves every requirement is satisfied. Call update_goal with status "blocked" only when the same blocker has repeated for 3 consecutive goal turns.',
      "Do not redefine the goal or stop because the work is partially done. Continue from the current repository state.",
    ].join("\n")
  }

  function budgetLimitPrompt(state: State) {
    return [
      "The active goal has reached its token budget.",
      "",
      "<objective>",
      state.objective,
      "</objective>",
      "",
      usageLine(state),
      `Time used: ${formatDuration(state.timeUsedSeconds)}`,
      `Iterations completed: ${state.iterationCount}`,
      "",
      "Do not start new substantive work. Wrap up this turn with progress, remaining work, and the concrete next action. Call update_goal only if the goal is actually complete or truly blocked under the repeated-blocker rule.",
    ].join("\n")
  }

  function iterationLimitPrompt(state: State) {
    return [
      "The active goal has reached the automatic continuation limit.",
      "",
      "<objective>",
      state.objective,
      "</objective>",
      "",
      usageLine(state),
      `Time used: ${formatDuration(state.timeUsedSeconds)}`,
      `Iterations completed: ${state.iterationCount}`,
      "",
      "Do not start new substantive work. Summarize the verified progress and remaining work. Call update_goal only if the goal is actually complete or truly blocked under the repeated-blocker rule.",
    ].join("\n")
  }

  export function parseArguments(input: string): ParsedArguments {
    const trimmed = input.trim()
    if (trimmed === "pause" || trimmed === "resume" || trimmed === "clear" || trimmed === "status") {
      return { type: "subcommand", command: trimmed }
    }

    let objective = trimmed
    let tokenBudget: number | undefined
    const budgetMatch = /(?:^|\s)--token-budget(?:\s+(\S+))?(?=\s|$)/.exec(objective)
    if (budgetMatch) {
      const rawBudget = budgetMatch[1]
      tokenBudget = rawBudget === undefined ? Number.NaN : Number(rawBudget)
      if (!/^\d+$/.test(rawBudget ?? "") || !Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) {
        throw new Error("--token-budget must be a positive integer")
      }
      objective = objective.replace(budgetMatch[0], " ").trim()
    }
    return { type: "objective", objective, tokenBudget }
  }

  export const layer = Layer.succeed(
    Service,
    Service.of({
      get: (sessionID) => Effect.tryPromise(() => getImpl(sessionID)),
      set: (sessionID, objective, tokenBudget) => Effect.tryPromise(() => setImpl(sessionID, objective, tokenBudget)),
      updateStatus: (sessionID, status) => Effect.tryPromise(() => updateStatusImpl(sessionID, status)),
      accountUsage: (sessionID, tokensDelta, timeDeltaSeconds) =>
        Effect.tryPromise(() => accountUsageImpl(sessionID, tokensDelta, timeDeltaSeconds)),
      incrementIteration: (sessionID) => Effect.tryPromise(() => incrementIterationImpl(sessionID)),
      pause: (sessionID) => Effect.tryPromise(() => updateStatusImpl(sessionID, "paused")),
      resume: (sessionID) => Effect.tryPromise(() => updateStatusImpl(sessionID, "active")),
      usageLimit: (sessionID) => Effect.tryPromise(() => updateStatusImpl(sessionID, "usage_limited")),
      clear: (sessionID) => Effect.tryPromise(() => clearImpl(sessionID)),
      isGoalContinueNeeded,
      isIterationLimitReached,
      continuationPrompt,
      budgetLimitPrompt,
      iterationLimitPrompt,
    }),
  )

  export const defaultLayer = layer
}
