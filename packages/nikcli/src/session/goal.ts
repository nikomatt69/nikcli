import { Context, Effect, Layer, Schema } from "effect"
import { zod, zodObject, zodObjectMode, type DeepMutable } from "@nikcli-ai/util/effect-zod"
import { Identifier } from "@nikcli-ai/util/id"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { GoalRepo } from "./goal-repo"

export namespace SessionGoal {
  export const MAX_ITERATIONS = 50

  export const StatusEffect = Schema.Literals([
    "active",
    "paused",
    "blocked",
    "usage_limited",
    "budget_limited",
    "complete",
  ])
  export const StatusSchema = zod(StatusEffect)
  export type Status = Schema.Schema.Type<typeof StatusEffect>

  export const StateEffect = Schema.Struct({
    sessionID: Schema.String,
    goalID: Schema.String,
    objective: Schema.String,
    status: StatusEffect,
    tokenBudget: Schema.optional(Schema.Number),
    tokensUsed: Schema.Number,
    timeUsedSeconds: Schema.Number,
    iterationCount: Schema.Number,
    timeCreated: Schema.Number,
    timeUpdated: Schema.Number,
  }).annotate({ ...zodObjectMode("strip"), identifier: "SessionGoalState" })
  export const StateSchema = zodObject(StateEffect)
  export type State = DeepMutable<Schema.Schema.Type<typeof StateEffect>>

  /** Broadcast whenever a session's goal state is created, updated, or cleared. */
  export const Event = {
    Updated: BusEvent.schema(
      "session.goal",
      Schema.Struct({
        sessionID: Schema.String,
        goal: Schema.NullOr(StateEffect),
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

  function publishGoal(sessionID: string, state: State | undefined) {
    void Bus.publish(Event.Updated, { sessionID, goal: state ?? null })
  }

  function getImpl(sessionID: string) {
    return GoalRepo.get(sessionID)
  }

  function setImpl(sessionID: string, objective: string, tokenBudget?: number) {
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
    GoalRepo.upsert(state)
    publishGoal(sessionID, state)
    return state
  }

  function updateStatusImpl(sessionID: string, status: Status) {
    const updated = GoalRepo.update(sessionID, (draft) => {
      draft.status = status
      draft.timeUpdated = Date.now()
    })
    if (!updated) return undefined
    publishGoal(sessionID, updated)
    return updated
  }

  function accountUsageImpl(sessionID: string, tokensDelta: number, timeDeltaSeconds: number) {
    const updated = GoalRepo.update(sessionID, (draft) => {
      draft.tokensUsed += Math.max(0, Math.floor(tokensDelta))
      draft.timeUsedSeconds += Math.max(0, Math.floor(timeDeltaSeconds))
      if (draft.status === "active" && draft.tokenBudget !== undefined && draft.tokensUsed >= draft.tokenBudget) {
        draft.status = "budget_limited"
      }
      draft.timeUpdated = Date.now()
    })
    if (!updated) return undefined
    publishGoal(sessionID, updated)
    return updated
  }

  function incrementIterationImpl(sessionID: string) {
    const updated = GoalRepo.update(sessionID, (draft) => {
      draft.iterationCount += 1
      draft.timeUpdated = Date.now()
    })
    if (!updated) return undefined
    publishGoal(sessionID, updated)
    return updated
  }

  function clearImpl(sessionID: string) {
    GoalRepo.remove(sessionID)
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
      get: (sessionID) => Effect.sync(() => getImpl(sessionID)),
      set: (sessionID, objective, tokenBudget) => Effect.sync(() => setImpl(sessionID, objective, tokenBudget)),
      updateStatus: (sessionID, status) => Effect.sync(() => updateStatusImpl(sessionID, status)),
      accountUsage: (sessionID, tokensDelta, timeDeltaSeconds) =>
        Effect.sync(() => accountUsageImpl(sessionID, tokensDelta, timeDeltaSeconds)),
      incrementIteration: (sessionID) => Effect.sync(() => incrementIterationImpl(sessionID)),
      pause: (sessionID) => Effect.sync(() => updateStatusImpl(sessionID, "paused")),
      resume: (sessionID) => Effect.sync(() => updateStatusImpl(sessionID, "active")),
      usageLimit: (sessionID) => Effect.sync(() => updateStatusImpl(sessionID, "usage_limited")),
      clear: (sessionID) => Effect.sync(() => clearImpl(sessionID)),
      isGoalContinueNeeded,
      isIterationLimitReached,
      continuationPrompt,
      budgetLimitPrompt,
      iterationLimitPrompt,
    }),
  )

  export const defaultLayer = layer
}
