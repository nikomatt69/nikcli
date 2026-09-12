import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { EOL } from "os"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { basename } from "path"
import { Session } from "@/session"
import type { MessageV2 } from "@/session/message-v2"
import { Identifier } from "@nikcli-ai/util/id"
import { ToolRegistry } from "@/tool/registry"
import { PermissionNext } from "@/permission/next"
import { bootstrap } from "@/cli/bootstrap"
import { InstanceState } from "@/effect"

export function agentGet(name: string) {
  return runPromiseWithLayer(
    Agent.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        return yield* agent.get(name)
      }),
    ),
  )
}

export function defaultProviderModel() {
  return runPromiseWithLayer(
    Provider.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        return yield* provider.defaultModel()
      }),
    ),
  )
}

export function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

export async function getAvailableTools(agent: Agent.Info) {
  const model = agent.model ?? (await defaultProviderModel())
  return runPromiseWithLayer(
    ToolRegistry.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        return yield* registry.tools(model, agent)
      }),
    ),
  )
}

export async function resolveTools(agent: Agent.Info, availableTools: Awaited<ReturnType<typeof getAvailableTools>>) {
  const disabled = PermissionNext.disabled(
    availableTools.map((tool: ToolRegistry.Resolved) => tool.id),
    agent.permission,
  )
  const resolved: Record<string, boolean> = {}
  for (const tool of availableTools) {
    resolved[tool.id] = !disabled.has(tool.id)
  }
  return resolved
}

export function parseToolParams(input?: string) {
  if (!input) return {}
  const trimmed = input.trim()
  if (trimmed.length === 0) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (jsonError) {
    throw new Error(`Failed to parse --params. Use valid JSON. Error: ${jsonError}.`)
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool params must be an object.")
  }
  return parsed as Record<string, unknown>
}

export async function createToolContext(agent: Agent.Info) {
  const session = await runSession(
    Effect.gen(function* () {
      const sessionService = yield* Session.Service
      return yield* sessionService.create({ title: `Debug tool run (${agent.name})` })
    }),
  )
  const messageID = Identifier.ascending("message")
  const model = agent.model ?? (await defaultProviderModel())
  const instance = InstanceState.ambient()
  const now = Date.now()
  const message: MessageV2.Assistant = {
    id: messageID,
    sessionID: session.id,
    role: "assistant",
    time: {
      created: now,
    },
    parentID: messageID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "debug",
    agent: agent.name,
    path: {
      cwd: instance.directory,
      root: instance.worktree,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  }
  await runSession(
    Effect.gen(function* () {
      const sessionService = yield* Session.Service
      yield* sessionService.updateMessage(message)
    }),
  )

  const ruleset = PermissionNext.merge(agent.permission, session.permission ?? [])

  return {
    instance,
    sessionID: session.id,
    messageID,
    callID: Identifier.ascending("part"),
    agent: agent.name,
    abort: new AbortController().signal,
    metadata: () => {},
    progress: async () => {},
    async ask(req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) {
      for (const pattern of req.patterns) {
        const rule = PermissionNext.evaluate(req.permission, pattern, ruleset)
        if (rule.action === "deny") {
          throw new PermissionNext.DeniedError({ ruleset })
        }
      }
    },
  }
}

export default Runtime.handler(Commands.commands["debug"].commands["agent"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    name: input["name"],
    tool: Option.getOrUndefined(input["tool"]),
    params: Option.getOrUndefined(input["params"]),
  }
  await bootstrap(process.cwd(), async () => {
    const agentName = args.name as string
    const agent = await agentGet(agentName)
    if (!agent) {
      process.stderr.write(
        `Agent ${agentName} not found, run '${basename(process.execPath)} agent list' to get an agent list` + EOL,
      )
      process.exit(1)
    }
    const availableTools = await getAvailableTools(agent)
    const resolvedTools = await resolveTools(agent, availableTools)
    const toolID = args.tool as string | undefined
    if (toolID) {
      const tool = availableTools.find((item: ToolRegistry.Resolved) => item.id === toolID)
      if (!tool) {
        process.stderr.write(`Tool ${toolID} not found for agent ${agentName}` + EOL)
        process.exit(1)
      }
      if (resolvedTools[toolID] === false) {
        process.stderr.write(`Tool ${toolID} is disabled for agent ${agentName}` + EOL)
        process.exit(1)
      }
      const params = parseToolParams(args.params as string | undefined)
      const ctx = await createToolContext(agent)
      const result = await tool.executeAsync(params, ctx)
      process.stdout.write(JSON.stringify({ tool: toolID, input: params, result }, null, 2) + EOL)
      return
    }

    const output = {
      ...agent,
      tools: resolvedTools,
    }
    process.stdout.write(JSON.stringify(output, null, 2) + EOL)
  })
})
