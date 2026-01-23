import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./subagents.txt"
import { Agent } from "@/agent/agent"
import { runSubtask } from "./task"

const parameters = z.object({
  agent: z.string().optional(),
  prompt: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  listAll: z.boolean().optional(),
})

type SubagentsMetadata = {
  summary?: Array<{ id: string; tool: string; state: { status: string; title?: string } }>
  sessionId?: string
  agent?: string
  tools?: string[]
  count?: number
}

function formatTools(items: string[]): string {
  if (items.length === 0) return "all"
  return items.join(", ")
}

function buildPrompt(prompt: string, context: Record<string, unknown> | undefined): string {
  if (!context) return prompt
  const payload = JSON.stringify(context, null, 2)
  return `Context:\n${payload}\n\nUser Task: ${prompt}`
}

export const SubagentsTool = Tool.define<typeof parameters, SubagentsMetadata>("subagents", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "subagents",
      patterns: [params.agent ?? "*"],
      always: ["*"],
      metadata: {
        agent: params.agent,
        listAll: params.listAll,
        hasPrompt: Boolean(params.prompt),
      },
    })

    if (params.prompt) {
      if (!params.agent) throw new Error("subagents requires 'agent' when 'prompt' is provided")
      const prompt = buildPrompt(params.prompt, params.context)
      const description = `Subagent ${params.agent}`
      return runSubtask(
        {
          description,
          prompt,
          subagent_type: params.agent,
        },
        ctx,
      )
    }

    const agents = await Agent.list().then((items) => items.filter((item) => item.mode !== "primary"))
    const requested = params.agent?.trim()
    if (requested) {
      const agent = agents.find((item) => item.name === requested)
      if (!agent) throw new Error(`Subagent '${requested}' not found`)
      const tools = Agent.SUBAGENT_TOOLSETS[agent.name] ?? []
      const output = [
        `name: ${agent.name}`,
        `mode: ${agent.mode}`,
        `description: ${agent.description ?? ""}`,
        `tools: ${formatTools(tools)}`,
      ].join("\n")
      return {
        title: agent.name,
        output,
        metadata: {
          agent: agent.name,
          tools,
        },
      }
    }

    const visible = params.listAll ? agents : agents.filter((item) => !item.hidden)
    const lines = visible.map((agent) => {
      const tools = Agent.SUBAGENT_TOOLSETS[agent.name] ?? []
      const desc = agent.description ?? ""
      return `- ${agent.name}: ${desc} (tools: ${formatTools(tools)})`
    })
    const output = lines.length > 0 ? lines.join("\n") : "No subagents available"
    return {
      title: `Subagents (${visible.length})`,
      output,
      metadata: {
        count: visible.length,
      },
    }
  },
})
