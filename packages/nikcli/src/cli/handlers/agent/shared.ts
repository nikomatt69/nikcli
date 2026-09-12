import { Agent } from "@/agent/agent"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Log } from "@nikcli-ai/util/log"
import z from "zod"

/** Helpers shared by the `agent` commands. */

export const log = Log.create({ service: "agent-command" })

export type AgentMode = "all" | "primary" | "subagent"

export const AgentModeSchema = z.enum(["all", "primary", "subagent"])

export const AVAILABLE_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "generate_image",
  "speak",
  "list",
  "glob",
  "grep",
  "webfetch",
  "task",
  "todowrite",
  "todoread",
] as const

export function agentGenerate(input: { description: string; model?: { providerID: string; modelID: string } }) {
  return runPromiseWithLayer(
    Agent.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        return yield* agent.generate(input)
      }),
    ),
  )
}

export function agentList() {
  return runPromiseWithLayer(
    Agent.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        return yield* agent.list()
      }),
    ),
  )
}
