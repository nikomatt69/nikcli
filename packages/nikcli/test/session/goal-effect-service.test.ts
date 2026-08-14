import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { removeTestDir } from "../helpers/fs"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-goal-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const [{ runPromiseWithLayer }, { Identifier }, { SessionGoal }] = await Promise.all([
  import("@/effect"),
  import("@nikcli-ai/util/id"),
  import("@/session/goal"),
])

function runGoal<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(SessionGoal.defaultLayer, effect)
}

afterAll(async () => {
  const { Database } = await import("@/database/database")
  Database.closeAll()
  await removeTestDir(testHome)
})

describe("SessionGoal.Service", () => {
  it("sets and reads a persisted goal with a nikcli goal id", async () => {
    const sessionID = Identifier.ascending("session")
    const result = await runGoal(
      Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        const created = yield* goal.set(sessionID, "ship goal mode", 100)
        const loaded = yield* goal.get(sessionID)
        return { created, loaded }
      }),
    )

    expect(result.created.goalID.startsWith("gol_")).toBe(true)
    expect(result.loaded?.goalID).toBe(result.created.goalID)
    expect(result.loaded?.objective).toBe("ship goal mode")
    expect(result.loaded?.tokenBudget).toBe(100)
    expect(result.loaded?.status).toBe("active")
  })

  it("tracks budget and stops continuation after usage limit", async () => {
    const sessionID = Identifier.ascending("session")
    const result = await runGoal(
      Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        yield* goal.set(sessionID, "respect budget", 10)
        const underBudget = yield* goal.accountUsage(sessionID, 8, 2)
        const budgetLimited = yield* goal.accountUsage(sessionID, 3, 1)
        const usageLimited = yield* goal.usageLimit(sessionID)
        return {
          underBudget,
          budgetLimited,
          usageLimited,
          continuesBeforeWrapUp: budgetLimited ? goal.isGoalContinueNeeded(budgetLimited) : false,
          continuesAfterWrapUp: usageLimited ? goal.isGoalContinueNeeded(usageLimited) : true,
        }
      }),
    )

    expect(result.underBudget?.status).toBe("active")
    expect(result.budgetLimited?.status).toBe("budget_limited")
    expect(result.budgetLimited?.tokensUsed).toBe(11)
    expect(result.continuesBeforeWrapUp).toBe(true)
    expect(result.usageLimited?.status).toBe("usage_limited")
    expect(result.continuesAfterWrapUp).toBe(false)
  })

  it("supports pause, resume, clear, and argument parsing", async () => {
    const sessionID = Identifier.ascending("session")
    const result = await runGoal(
      Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        yield* goal.set(sessionID, "pauseable goal")
        const paused = yield* goal.pause(sessionID)
        const resumed = yield* goal.resume(sessionID)
        yield* goal.clear(sessionID)
        const cleared = yield* goal.get(sessionID)
        return { paused, resumed, cleared }
      }),
    )

    expect(result.paused?.status).toBe("paused")
    expect(result.resumed?.status).toBe("active")
    expect(result.cleared).toBeUndefined()
    expect(SessionGoal.parseArguments("pause")).toEqual({ type: "subcommand", command: "pause" })
    expect(SessionGoal.parseArguments("--token-budget 42 finish the migration")).toEqual({
      type: "objective",
      objective: "finish the migration",
      tokenBudget: 42,
    })
    expect(() => SessionGoal.parseArguments("--token-budget 0 finish the migration")).toThrow(
      "--token-budget must be a positive integer",
    )
    expect(() => SessionGoal.parseArguments("--token-budget -1 finish the migration")).toThrow(
      "--token-budget must be a positive integer",
    )
  })

  it("builds continuation prompts that require evidence before completion", async () => {
    const sessionID = Identifier.ascending("session")
    const prompt = await runGoal(
      Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        yield* goal.set(sessionID, "verify every path")
        const state = yield* goal.incrementIteration(sessionID)
        if (!state) throw new Error("expected goal state")
        return goal.continuationPrompt(state)
      }),
    )

    expect(prompt).toContain("verify every path")
    expect(prompt).toContain(`Iteration: 1 / ${SessionGoal.MAX_ITERATIONS}`)
    expect(prompt).toContain("update_goal")
    expect(prompt).toContain("current evidence")
  })
})
