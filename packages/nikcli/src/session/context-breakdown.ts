import { Effect } from "effect"
import z from "zod"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"
import { Provider } from "@/provider/provider"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { ToolRegistry } from "@/tool/registry"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Token } from "@nikcli-ai/util/token"
import { Log } from "@nikcli-ai/util/log"
import { runPromiseWithLayer, withCurrentInstance, InstanceState, type InstanceContext } from "@/effect"
import { collectSystemPaths } from "./instruction"

const log = Log.create({ service: "session.context-breakdown" })

export namespace SessionContext {
  /** A single, attributable source of context tokens. */
  export const Source = z.object({
    id: z.string(),
    category: z.enum(["system", "instructions", "skills", "mcp", "tools", "agents", "messages"]),
    label: z.string(),
    detail: z.string().optional(),
    tokens: z.number(),
    enabled: z.boolean(),
    togglable: z.boolean(),
    toggleKind: z.enum(["mcp", "skill", "instruction", "tool"]).optional(),
    toggleKey: z.string().optional(),
  })
  export type Source = z.infer<typeof Source>

  export const Breakdown = z.object({
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
        name: z.string(),
        contextLimit: z.number(),
      })
      .optional(),
    reported: z.object({
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
      total: z.number(),
    }),
    sources: z.array(Source),
    estimatedTotal: z.number(),
  })
  export type Breakdown = z.infer<typeof Breakdown>

  function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
    return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
  }
  function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
    return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
  }
  function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
    return runPromiseWithLayer(Config.defaultLayer, withCurrentInstance(effect))
  }
  function runMCP<A, E>(effect: Effect.Effect<A, E, MCP.Service>) {
    return runPromiseWithLayer(MCP.defaultLayer, withCurrentInstance(effect))
  }
  function runRegistry<A, E>(effect: Effect.Effect<A, E, ToolRegistry.Service>) {
    return runPromiseWithLayer(ToolRegistry.defaultLayer, withCurrentInstance(effect))
  }
  function runAgent<A, E>(effect: Effect.Effect<A, E, Agent.Service>) {
    return runPromiseWithLayer(Agent.defaultLayer, withCurrentInstance(effect))
  }
  function runSkill<A, E>(effect: Effect.Effect<A, E, Skill.Service>) {
    return runPromiseWithLayer(Skill.defaultLayer, withCurrentInstance(effect))
  }
  function runSystemPrompt<A, E>(effect: Effect.Effect<A, E, SystemPrompt.Service>) {
    return runPromiseWithLayer(SystemPrompt.defaultLayer, withCurrentInstance(effect))
  }

  function currentContext(): InstanceContext {
    return InstanceState.ambient()
  }

  const est = (s: string) => Token.estimate(s)

  /** Best-effort token estimate for a single resolved tool (description + JSON schema). */
  function toolTokens(description: string, schema: unknown): number {
    let schemaText = ""
    try {
      schemaText = JSON.stringify(schema ?? {})
    } catch {
      schemaText = ""
    }
    return est((description ?? "") + " " + schemaText)
  }

  /** Sum the visible text content of a session's messages (the conversation history). */
  async function conversationTokens(sessionID: string): Promise<number> {
    let total = 0
    for await (const item of MessageV2.stream(sessionID)) {
      for (const part of item.parts) {
        if (part.type === "text") total += est(part.text ?? "")
        else if (part.type === "reasoning") total += est(part.text ?? "")
        else if (part.type === "tool" && part.state.status === "completed") {
          total += est(String(part.state.output ?? ""))
          try {
            total += est(JSON.stringify(part.state.input ?? {}))
          } catch {}
        }
      }
    }
    return total
  }

  async function lastTokens(sessionID: string) {
    let last: MessageV2.Assistant | undefined
    let lastModel: { providerID: string; modelID: string } | undefined
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "assistant") {
        const info = item.info as MessageV2.Assistant
        if (info.tokens.output > 0) last = info
      }
      if (item.info.role === "user" && item.info.model) lastModel = item.info.model
    }
    return { last, lastModel }
  }

  export async function breakdown(sessionID: string): Promise<Breakdown> {
    const session = await runSession(
      Effect.gen(function* () {
        const service = yield* Session.Service
        return yield* service.get(sessionID)
      }),
    )

    const { last, lastModel } = await lastTokens(sessionID)

    const modelRef = last
      ? { providerID: last.providerID, modelID: last.modelID }
      : (lastModel ??
        (await runProvider(
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const model = yield* provider.defaultModel()
            return { providerID: model.providerID, modelID: model.modelID }
          }),
        ).catch(() => undefined)))

    const model = modelRef
      ? await runProvider(
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            return yield* provider.getModel(modelRef.providerID, modelRef.modelID)
          }),
        ).catch(() => undefined)
      : undefined

    const reported = last
      ? {
          input: last.tokens.input,
          output: last.tokens.output,
          reasoning: last.tokens.reasoning,
          cacheRead: last.tokens.cache.read,
          cacheWrite: last.tokens.cache.write,
          total:
            last.tokens.total ??
            last.tokens.input +
              last.tokens.output +
              last.tokens.reasoning +
              last.tokens.cache.read +
              last.tokens.cache.write,
        }
      : { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }

    const config = await runConfig(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )

    const ctx = currentContext()
    const sources: Source[] = []

    // 1. System prompt (provider header + base instructions) — always present.
    if (model) {
      const systemText = [...SystemPrompt.header(model.providerID), ...SystemPrompt.provider(model)].join("\n")
      sources.push({
        id: "system:prompt",
        category: "system",
        label: "System prompt",
        detail: model.name,
        tokens: est(systemText),
        enabled: true,
        togglable: false,
      })
    }

    // 2. Environment block.
    const environment = await runSystemPrompt(
      Effect.gen(function* () {
        const service = yield* SystemPrompt.Service
        return yield* service.environment()
      }),
    ).catch(() => [] as string[])
    if (environment.length > 0) {
      sources.push({
        id: "system:environment",
        category: "system",
        label: "Environment",
        detail: ctx.directory,
        tokens: est(environment.join("\n")),
        enabled: true,
        togglable: false,
      })
    }

    // 2b. User profile block — small, but it is in every request, so it belongs
    //     in the breakdown rather than hiding inside "System prompt".
    const profile = await runSystemPrompt(
      Effect.gen(function* () {
        const service = yield* SystemPrompt.Service
        return yield* service.profile()
      }),
    ).catch(() => [] as string[])
    if (profile.length > 0) {
      sources.push({
        id: "system:profile",
        category: "system",
        label: "User profile",
        detail: "/profile",
        tokens: est(profile.join("\n")),
        enabled: true,
        togglable: false,
      })
    }

    // 3. Instruction files (AGENTS.md, CLAUDE.md, config instructions) — one source per
    //    file/url, togglable. Disabled files are still read so their token cost is shown.
    const disabledInstructions = new Set(session.disabledInstructions ?? [])
    const { paths, urls } = await collectSystemPaths(ctx, config).catch(() => ({ paths: new Set<string>(), urls: [] }))
    await Promise.all(
      Array.from(paths).map(async (p) => {
        const text = await Bun.file(p)
          .text()
          .catch(() => "")
        if (!text) return
        const enabled = !disabledInstructions.has(p)
        sources.push({
          id: "instructions:" + p,
          category: "instructions",
          label: p.split("/").pop() || p,
          detail: p,
          tokens: est(text),
          enabled,
          togglable: true,
          toggleKind: "instruction",
          toggleKey: p,
        })
      }),
    )
    for (const url of urls) {
      sources.push({
        id: "instructions:" + url,
        category: "instructions",
        label: new URL(url).hostname,
        detail: url,
        tokens: 0,
        enabled: !disabledInstructions.has(url),
        togglable: true,
        toggleKind: "instruction",
        toggleKey: url,
      })
    }

    // 4. Active skills — one source per skill, togglable off.
    const activeSkills = session.skills ?? []
    await Promise.all(
      activeSkills.map(async (name) => {
        const loaded = await runSkill(
          Effect.gen(function* () {
            const skill = yield* Skill.Service
            return yield* skill.load(name)
          }),
        ).catch(() => undefined)
        sources.push({
          id: "skill:" + name,
          category: "skills",
          label: name,
          detail: loaded?.description ?? Skill.commandName(name),
          tokens: loaded ? est(loaded.content) : 0,
          enabled: true,
          togglable: true,
          toggleKind: "skill",
          toggleKey: name,
        })
      }),
    )

    // 5. MCP servers — group connected tools by server, include disabled servers as togglable-on.
    const mcpConfig = config.mcp ?? {}
    const mcpStatus = await runMCP(
      Effect.gen(function* () {
        const service = yield* MCP.Service
        return yield* service.status()
      }),
    ).catch(() => ({}) as Record<string, { status: string }>)
    const mcpTools = await runMCP(
      Effect.gen(function* () {
        const service = yield* MCP.Service
        return yield* service.tools()
      }),
    ).catch(() => ({}) as Record<string, unknown>)

    const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_")
    for (const name of Object.keys(mcpConfig)) {
      const status = mcpStatus[name]?.status ?? "disabled"
      const enabled = mcpConfig[name]?.enabled !== false && status === "connected"
      const prefix = sanitize(name) + "_"
      let tokens = 0
      let count = 0
      for (const [key, t] of Object.entries(mcpTools)) {
        if (!key.startsWith(prefix)) continue
        const tool = t as { description?: string; inputSchema?: { jsonSchema?: unknown } }
        tokens += toolTokens(tool.description ?? "", tool.inputSchema?.jsonSchema ?? tool.inputSchema)
        count++
      }
      sources.push({
        id: "mcp:" + name,
        category: "mcp",
        label: name,
        detail: enabled ? `${count} tool${count === 1 ? "" : "s"} · ${status}` : status,
        tokens,
        enabled,
        togglable: true,
        toggleKind: "mcp",
        toggleKey: name,
      })
    }

    // 6. Built-in tools — one togglable source per tool (schema + description),
    //    reflecting session.disabledTools.
    const disabledTools = session.disabledTools ?? {}
    if (model) {
      const tools = await runRegistry(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          return yield* registry.tools({ providerID: model.providerID, modelID: model.id })
        }),
      ).catch(() => [] as ToolRegistry.Resolved[])
      for (const tool of tools) {
        let schema: unknown = {}
        try {
          schema = z.toJSONSchema(tool.parameters)
        } catch {}
        const firstLine = (tool.description ?? "").split("\n")[0]?.trim()
        sources.push({
          id: "tool:" + tool.id,
          category: "tools",
          label: tool.id,
          // `detail` is `optionalKey` on the route: a present `undefined`
          // fails the response encode instead of omitting the field.
          ...(firstLine ? { detail: firstLine.slice(0, 80) } : undefined),
          tokens: toolTokens(tool.description, schema),
          enabled: ToolRegistry.enabled(tool.id, disabledTools),
          togglable: true,
          toggleKind: "tool",
          toggleKey: tool.id,
        })
      }
    }

    // 7. Custom agents — feed the task tool / subagent routing.
    const agents = await runAgent(
      Effect.gen(function* () {
        const service = yield* Agent.Service
        return yield* service.list()
      }),
    ).catch(() => [] as Agent.Info[])
    const customAgents = agents.filter((a) => !a.hidden)
    if (customAgents.length > 0) {
      const tokens = customAgents.reduce((sum, a) => sum + est(a.name + " " + (a.description ?? "")), 0)
      sources.push({
        id: "agents:custom",
        category: "agents",
        label: "Agents",
        detail: `${customAgents.length} available`,
        tokens,
        enabled: true,
        togglable: false,
      })
    }

    // 8. Conversation history.
    const convTokens = await conversationTokens(sessionID).catch((e) => {
      log.warn("conversation token estimate failed", { error: String(e) })
      return 0
    })
    sources.push({
      id: "messages:conversation",
      category: "messages",
      label: "Conversation",
      detail: "Messages, tool calls & results",
      tokens: convTokens,
      enabled: true,
      togglable: false,
    })

    const estimatedTotal = sources.filter((s) => s.enabled).reduce((sum, s) => sum + s.tokens, 0)

    return {
      ...(model
        ? {
            model: {
              providerID: model.providerID,
              modelID: model.id,
              name: model.name,
              contextLimit: model.limit.input ?? model.limit.context,
            },
          }
        : undefined),
      reported,
      sources,
      estimatedTotal,
    }
  }
}
