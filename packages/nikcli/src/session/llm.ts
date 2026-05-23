import os from "os"
import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  convertToModelMessages,
  modelMessageSchema,
  wrapLanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  type UIMessage,
  extractReasoningMiddleware,
  tool,
  jsonSchema,
} from "ai"
import { LLMCore, Runtime as LLMRuntime, ToolChoice } from "@nikcli-ai/llm"
import {
  Message as LLMMessage,
  type ModelRef,
  type ContentPart,
  type ToolDefinition,
  LLMRequest as LLMRequestClass,
  SystemPart,
  GenerationOptions,
  HttpOptions,
} from "@nikcli-ai/llm"
import { clone, mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

export namespace LLM {
  const log = Log.create({ service: "llm" })
  export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

  function runAuth<A, E>(effect: Effect.Effect<A, E, Auth.Service>) {
    return runPromiseWithLayer(Auth.defaultLayer, effect)
  }

  function runPlugin<A, E>(effect: Effect.Effect<A, E, Plugin.Service>) {
    return runPromiseWithLayer(Plugin.defaultLayer, withCurrentInstance(effect))
  }

  function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
    return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
  }

  function configGet() {
    return runPromiseWithLayer(
      Config.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.get()
        }),
      ),
    )
  }

  // Build request headers based on provider and model configuration
  function buildRequestHeaders(
    providerID: string,
    sessionID: string,
    userID: string,
    isCodex: boolean,
    modelHeaders?: Record<string, string>,
  ): Record<string, string> | undefined {
    if (isCodex) {
      return {
        originator: "nikcli",
        "User-Agent": `nikcli/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
        session_id: sessionID,
      }
    }

    if (providerID.startsWith("nikcli")) {
      return {
        "x-nikcli-project": Instance.project.id,
        "x-nikcli-session": sessionID,
        "x-nikcli-request": userID,
        "x-nikcli-client": Flag.NIKCLI_CLIENT,
      }
    }

    if (providerID !== "anthropic") {
      return {
        "User-Agent": `nikcli/${Installation.VERSION}`,
      }
    }

    // Return undefined for anthropic (no extra headers needed)
    return undefined
  }

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    toolChoice?: "auto" | "required" | "none"
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  function isModelMessage(message: unknown): message is ModelMessage {
    return modelMessageSchema.safeParse(message).success
  }

  function isUIMessage(message: unknown): message is UIMessage {
    if (!message || typeof message !== "object") return false
    const candidate = message as { role?: unknown; parts?: unknown }
    return (
      (candidate.role === "user" || candidate.role === "assistant") &&
      Array.isArray(candidate.parts)
    )
  }

  function uiToolOutput(output: unknown) {
    if (typeof output === "string") return { type: "text" as const, value: output }
    return { type: "json" as const, value: output as never }
  }

  function uiMessageTools(messages: UIMessage[]) {
    const tools: Record<string, { toModelOutput(output: unknown): ReturnType<typeof uiToolOutput> }> = {}
    for (const message of messages) {
      for (const part of message.parts) {
        if (!part.type.startsWith("tool-")) continue
        tools[part.type.slice("tool-".length)] = { toModelOutput: uiToolOutput }
      }
    }
    return tools
  }

  export function normalizeStreamMessages(messages: unknown[]): ModelMessage[] {
    const result: ModelMessage[] = []
    let uiRun: UIMessage[] = []

    const flushUIRun = () => {
      if (uiRun.length === 0) return
      result.push(
        ...convertToModelMessages(uiRun, {
          // @ts-expect-error convertToModelMessages only needs each matching tool's toModelOutput.
          tools: uiMessageTools(uiRun),
        }),
      )
      uiRun = []
    }

    for (const message of messages) {
      if (isModelMessage(message)) {
        flushUIRun()
        result.push(message)
        continue
      }
      if (isUIMessage(message)) {
        uiRun.push(message)
        continue
      }
      flushUIRun()
      result.push(message as ModelMessage)
    }

    flushUIRun()
    return result
  }

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [{ language, provider, modelRef }, cfg, auth] = await Promise.all([
      runProvider(
        Effect.gen(function* () {
          const service = yield* Provider.Service
          const language = yield* service.getLanguage(input.model)
          const provider = yield* service.getProvider(input.model.providerID)
          const modelRef = yield* service.getModelRef(input.model)
          return { language, provider, modelRef }
        }),
      ),
      configGet(),
      runAuth(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          return yield* auth.get(input.model.providerID)
        }),
      ),
    ])
    if (!provider) {
      throw new Provider.ModelNotFoundError({ providerID: input.model.providerID, modelID: input.model.id })
    }
    if (modelRef) {
      l.debug("model ref resolved", {
        route: modelRef.route,
        baseURL: modelRef.baseURL,
        modelID: modelRef.id,
        providerID: modelRef.provider,
      })
    }
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    const system = SystemPrompt.header(input.model.providerID)
    system.push(
      [
        // use agent prompt otherwise provider prompt
        // For Codex sessions, skip SystemPrompt.provider() since it's sent via options.instructions
        ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    const original = clone(system)
    await runPlugin(
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        yield* plugin.trigger("experimental.chat.system.transform", { sessionID: input.sessionID }, { system })
      }),
    )
    if (system.length === 0) {
      system.push(...original)
    }
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (isCodex) {
      options.instructions = SystemPrompt.instructions()
    }

    const params = await runPlugin(
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        return yield* plugin.trigger(
          "chat.params",
          {
            sessionID: input.sessionID,
            agent: input.agent,
            model: input.model,
            provider,
            message: input.user,
          },
          {
            temperature: input.model.capabilities.temperature
              ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
              : undefined,
            topP: input.agent.topP ?? ProviderTransform.topP(input.model),
            topK: ProviderTransform.topK(input.model),
            options,
          },
        )
      }),
    )

    // Run the request through @nikcli-ai/llm's route-based provider stack to
    // compile a provider-native body. This exercises the route registered by
    // @nikcli-ai/llm/providers end-to-end (body.from + transport.prepare) — proving
    // the route resolves even though the actual HTTP dispatch still goes through
    // the AI SDK path below.
    if (modelRef) {
      try {
        const llmRequest = buildLLMRequest(
          input,
          modelRef,
          {
            temperature: params.temperature,
            topP: params.topP,
            topK: params.topK,
            options: params.options,
          },
          buildRequestHeaders(input.model.providerID, input.sessionID, input.user.id, isCodex, input.model.headers),
        )
        const prepared = await LLMRuntime.prepareRequest(llmRequest)
        l.debug("LLM request prepared via @nikcli-ai/llm route", {
          modelID: modelRef.id,
          providerID: modelRef.provider,
          route: prepared.route,
          protocol: prepared.protocol,
          msgCount: llmRequest.messages.length,
          toolCount: llmRequest.tools.length,
        })
      } catch (e) {
        l.warn("LLM request prepare failed (non-fatal)", { error: String(e) })
      }
    }

    const maxOutputTokens =
      isCodex || provider.id.includes("github-copilot") ? undefined : ProviderTransform.maxOutputTokens(input.model)

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    const messages = normalizeStreamMessages([
      ...(isCodex
        ? [
            {
              role: "user",
              content: system.join("\n\n"),
            } as ModelMessage,
          ]
        : system.map(
            (x): ModelMessage => ({
              role: "system",
              content: x,
            }),
          )),
      ...input.messages,
    ])

    const result = LLMCore.stream({
      onError(error) {
        l.error("stream error", {
          error,
        })
      },
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()
        const repaired = Object.keys(tools).find((toolName) => toolName.toLowerCase() === lower)
        if (repaired && repaired !== failed.toolCall.toolName) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired,
          })
          return {
            ...failed.toolCall,
            toolName: repaired,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid" && x !== "_noop"),
      tools,
      toolChoice: input.toolChoice,
      maxOutputTokens,
      abortSignal: input.abort,
      maxRetries: input.retries ?? 0,
      headers: buildRequestHeaders(
        input.model.providerID,
        input.sessionID,
        input.user.id,
        isCodex,
        input.model.headers,
      ),
      messages,
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
              }
              return args.params
            },
          },
          extractReasoningMiddleware({ tagName: "think", startWithReasoning: false }),
        ],
      }),
      experimental_telemetry: { isEnabled: cfg.experimental?.openTelemetry },
    })
    // Suppress unhandled NoContentGeneratedError when model produces only tool calls (no text).
    // processor.ts consumes fullStream only; stream.text rejects if no text is generated.
    return LLMCore.suppressNoContentText(result)
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const tools = { ...input.tools }
    const disabled = PermissionNext.disabled(Object.keys(tools), input.agent.permission)
    for (const tool of Object.keys(tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete tools[tool]
      }
    }
    return tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }

  // ── @nikcli-ai/llm converters ──────────────────────────────────────────

  /**
   * Convert an AI SDK TextPart / ImagePart / FilePart into a @nikcli-ai/llm ContentPart.
   */
  function toLLMContentPart(part: ModelMessage["content"][number]): ContentPart | undefined {
    if (typeof part === "string") {
      return { type: "text" as const, text: part }
    }
    switch (part.type) {
      case "text":
        return { type: "text" as const, text: (part as any).text }
      case "image": {
        const p = part as any
        if (typeof p.image === "string") {
          return { type: "media" as const, mediaType: p.mimeType ?? "image/png", data: p.image }
        }
        return p.image instanceof Uint8Array
          ? { type: "media" as const, mediaType: p.mimeType ?? "image/png", data: p.image }
          : undefined
      }
      case "file": {
        const p = part as any
        if (typeof p.data === "string") {
          const match = /^data:([^;]+);/.exec(p.data)
          return {
            type: "media" as const,
            mediaType: match?.[1] ?? p.mimeType ?? "application/octet-stream",
            data: p.data,
          }
        }
        return p.data instanceof Uint8Array
          ? { type: "media" as const, mediaType: p.mimeType ?? "application/octet-stream", data: p.data }
          : undefined
      }
      default:
        return undefined
    }
  }

  /**
   * Convert an AI SDK ModelMessage[] into @nikcli-ai/llm Message[].
   */
  function modelMessagesToLLMMessages(
    msgs: ModelMessage[],
  ): typeof LLMMessage extends new (...args: any[]) => infer I ? I[] : any[] {
    const result: any[] = []
    for (const msg of msgs) {
      switch (msg.role) {
        case "user": {
          const parts: ContentPart[] =
            typeof msg.content === "string"
              ? msg.content
                ? [{ type: "text" as const, text: msg.content }]
                : []
              : msg.content.map(toLLMContentPart).filter((p): p is ContentPart => p !== undefined)
          if (parts.length > 0) result.push(LLMMessage.user(parts))
          break
        }
        case "assistant": {
          const parts: ContentPart[] = []
          if (typeof msg.content === "string") {
            if (msg.content) parts.push({ type: "text" as const, text: msg.content })
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              const p = part as any
              if (p.type === "text") {
                parts.push({ type: "text" as const, text: p.text })
              } else if (p.type === "reasoning") {
                parts.push({ type: "reasoning" as const, text: p.text })
              }
            }
          }
          // Map tool calls from the assistant message (AI SDK format varies by version)
          const toolCalls = (msg as any).tool_calls ?? (msg as any).parts?.filter((p: any) => p.type === "tool-call")
          if (toolCalls) {
            for (const tc of toolCalls) {
              try {
                parts.push({
                  type: "tool-call" as const,
                  id: tc.id ?? tc.toolCallId ?? `tc-${parts.length}`,
                  name: tc.function?.name ?? tc.toolName ?? "unknown",
                  input: tc.function?.arguments
                    ? typeof tc.function.arguments === "string"
                      ? JSON.parse(tc.function.arguments)
                      : tc.function.arguments
                    : (tc.input ?? {}),
                } as ContentPart)
              } catch {
                parts.push({
                  type: "tool-call" as const,
                  id: tc.id ?? tc.toolCallId ?? `tc-${parts.length}`,
                  name: tc.function?.name ?? tc.toolName ?? "unknown",
                  input: {},
                } as ContentPart)
              }
            }
          }
          if (parts.length > 0) result.push(LLMMessage.assistant(parts))
          break
        }
        case "tool": {
          const text =
            typeof msg.content === "string"
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content.map((p: any) => (typeof p === "string" ? p : (p.text ?? ""))).join("\n")
                : String((msg as any).content ?? "")
          result.push(
            LLMMessage.tool({
              type: "tool-result" as const,
              id: (msg as any).tool_call_id ?? `tr-${result.length}`,
              name: (msg as any).tool_call_name ?? "unknown",
              result: { type: "text" as const, value: text },
            }),
          )
          break
        }
      }
    }
    return result
  }

  /**
   * Convert an AI SDK Tool map into @nikcli-ai/llm ToolDefinition[].
   */
  function toLLMToolDefinitions(tools: Record<string, Tool>): ToolDefinition[] {
    return Object.entries(tools)
      .filter(([, t]) => !!t.description)
      .map(([name, t]) => ({
        name,
        description: t.description ?? "",
        inputSchema: ((t as any).parameters ?? (t as any).inputSchema ?? {}) as Record<string, unknown>,
      })) as ToolDefinition[]
  }

  /**
   * Build an @nikcli-ai/llm LLMRequest from the stream input and resolved ModelRef.
   */
  export function buildLLMRequest(
    input: StreamInput,
    modelRef: ModelRef,
    genParams: { temperature?: number; topP?: number; topK?: number; options?: Record<string, unknown> },
    headers?: Record<string, string>,
  ): LLMRequestClass {
    // System parts
    const system = SystemPart.content(input.system.join("\n\n"))

    // Messages
    const messages = modelMessagesToLLMMessages(input.messages)

    // Generation options
    const generation = new GenerationOptions({
      maxTokens: genParams.options?.["maxOutputTokens"] as number | undefined,
      temperature: genParams.temperature,
      topP: genParams.topP,
      topK: genParams.topK,
    })
    const hasGen = Object.values(generation).some((v) => v !== undefined)

    // HTTP options
    const httpOptions = headers && Object.keys(headers).length > 0 ? new HttpOptions({ headers }) : undefined

    // Tool definitions
    const tools = toLLMToolDefinitions(input.tools)

    return new LLMRequestClass({
      model: modelRef,
      system,
      messages,
      tools,
      generation: hasGen ? generation : undefined,
      http: httpOptions, 
      toolChoice: input.toolChoice === "required" ? ToolChoice.make("any") : input.toolChoice === "none" ? ToolChoice.make("none") : undefined,     
    })
  }
}
