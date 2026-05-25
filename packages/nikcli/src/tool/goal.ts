import z from "zod"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Session } from "@/session"
import { SessionGoal } from "@/session/goal"
import { Tool } from "./tool"

const CreateGoalParams = z.object({
  objective: z.string().min(1).describe("The goal to achieve in this session"),
  tokenBudget: z.number().int().positive().optional().describe("Optional token budget for the goal"),
})

const UpdateGoalParams = z.object({
  status: z
    .union([z.literal("complete"), z.literal("blocked")])
    .describe('New status: "complete" when achieved, or "blocked" when truly blocked'),
})

function runGoal<A, E>(effect: Effect.Effect<A, E, SessionGoal.Service>) {
  return runPromiseWithLayer(SessionGoal.defaultLayer, effect)
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function formatGoal(goal: SessionGoal.State) {
  return [
    `Objective: ${goal.objective}`,
    `Status: ${goal.status}`,
    goal.tokenBudget === undefined ? `Tokens: ${goal.tokensUsed}` : `Tokens: ${goal.tokensUsed} / ${goal.tokenBudget}`,
    `Iterations: ${goal.iterationCount} / ${SessionGoal.MAX_ITERATIONS}`,
    `Time used: ${SessionGoal.formatDuration(goal.timeUsedSeconds)}`,
  ].join("\n")
}

function goalMetadata(goal: SessionGoal.State | undefined) {
  return { goal }
}

function setActiveCommand(sessionID: string, activeCommand: string | undefined) {
  return runSession(
    Effect.gen(function* () {
      const session = yield* Session.Service
      yield* session.update(
        sessionID,
        (draft) => {
          draft.activeCommand = activeCommand
        },
        { touch: false },
      )
    }),
  )
}

export const CreateGoalTool = Tool.define("create_goal", {
  description: `Set or replace the active goal for the current session.

Only use this tool when the user explicitly asks for a goal, the active goal was lost, or the objective clearly changed.`,
  parameters: CreateGoalParams,
  async execute(params, ctx) {
    const goal = await runGoal(
      Effect.gen(function* () {
        const service = yield* SessionGoal.Service
        return yield* service.set(ctx.sessionID, params.objective, params.tokenBudget)
      }),
    )
    await setActiveCommand(ctx.sessionID, "goal")
    return {
      title: `Goal set: ${goal.objective}`,
      output: formatGoal(goal),
      metadata: { goal },
    }
  },
})

export const GetGoalTool = Tool.define("get_goal", {
  description: "Get the active goal state for this session.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const goal = await runGoal(
      Effect.gen(function* () {
        const service = yield* SessionGoal.Service
        return yield* service.get(ctx.sessionID)
      }),
    )
    if (!goal) {
      return {
        title: "No active goal",
        output: "No active goal is set for this session.",
        metadata: goalMetadata(undefined),
      }
    }
    return {
      title: `Goal: ${goal.objective}`,
      output: formatGoal(goal),
      metadata: goalMetadata(goal),
    }
  },
})

export const UpdateGoalTool = Tool.define("update_goal", {
  description: `Update the active goal status.

Call with status "complete" only after verifying every requirement is satisfied.
Call with status "blocked" only when the same blocking condition has repeated for 3 consecutive goal turns.`,
  parameters: UpdateGoalParams,
  async execute(params, ctx) {
    const goal = await runGoal(
      Effect.gen(function* () {
        const service = yield* SessionGoal.Service
        return yield* service.updateStatus(ctx.sessionID, params.status)
      }),
    )
    if (!goal) {
      return {
        title: "No active goal",
        output: "No active goal found for this session.",
        metadata: goalMetadata(undefined),
      }
    }
    await setActiveCommand(ctx.sessionID, undefined)
    return {
      title: `Goal ${params.status}`,
      output: formatGoal(goal),
      metadata: goalMetadata(goal),
    }
  },
})
