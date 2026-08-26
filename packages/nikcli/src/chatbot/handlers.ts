import { Chat, type Thread, type Message } from "chat"
import { ChatBot } from "./index"
import { streamText, type ModelMessage, wrapLanguageModel } from "ai"
import { Provider } from "../provider/provider"
import { Config } from "../config/config"
import { Log } from "@nikcli-ai/util/log"
import { SystemPrompt } from "../session/system"
import { Plugin } from "../plugin"
import { clone } from "remeda"
import { ProviderTransform } from "../provider/transform"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync, type InstanceContext } from "@/effect"

const log = Log.create({ service: "chatbot-handlers" })

export namespace BotHandlers {
  const DEFAULT_PROMPT = `You are nikcli, an AI coding assistant. You help users with software engineering tasks including writing code, debugging, answering questions, and more. Be concise and helpful.`
  const registeredBots = new WeakSet<Chat>()

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

  export async function handleMention(
    thread: Thread,
    message: Message,
    opts?: {
      prompt?: string
      tools?: Record<string, any>
    },
  ): Promise<void> {
    await thread.subscribe()

    const spinner = await thread.post("Thinking...")

    try {
      const response = await generateResponse(message.text, opts?.prompt, opts?.tools)

      await spinner.edit(response)
    } catch (error) {
      log.error("Error generating response", { error })
      await spinner.edit("Sorry, I encountered an error processing your request.")
    }
  }

  export async function handleMessage(
    thread: Thread,
    message: Message,
    opts?: {
      prompt?: string
      tools?: Record<string, any>
    },
  ): Promise<void> {
    if (!message.isMention) return

    await thread.startTyping()

    try {
      const response = await generateResponse(message.text, opts?.prompt, opts?.tools)

      await thread.post(response)
    } catch (error) {
      log.error("Error generating response", { error })
      await thread.post("Sorry, I encountered an error processing your request.")
    }
  }

  async function generateResponse(
    userMessage: string,
    customPrompt?: string,
    _customTools?: Record<string, any>,
  ): Promise<string> {
    const { model, language } = await runProvider(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const modelInfo = yield* provider.defaultModel()
        const model = yield* provider.getModel(modelInfo.providerID, modelInfo.modelID)
        const language = yield* provider.getLanguage(model)
        return { model, language }
      }),
    )

    const sessionID = `chatbot-${Date.now()}`

    // Build system parts array for plugin transformation (mirrors llm.ts pattern)
    const systemParts = [...SystemPrompt.header(model.providerID), customPrompt || DEFAULT_PROMPT].filter(Boolean)

    const original = clone(systemParts)
    await runPlugin(
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        yield* plugin.trigger("experimental.chat.system.transform", { sessionID }, { system: systemParts })
      }),
    )
    if (systemParts.length === 0) {
      systemParts.push(...original)
    }

    const messages: ModelMessage[] = [{ role: "user", content: userMessage }]

    const result = await streamText({
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, model, {})
              }
              return args.params
            },
          },
        ],
      }),
      system: systemParts.join("\n"),
      messages,
      onError({ error }) {
        log.error("stream error", { error })
        throw error
      },
    })

    let fullResponse = ""
    for await (const chunk of result.textStream) {
      fullResponse += chunk
    }

    const finishReason = await result.finishReason
    if (!fullResponse && finishReason === "error") {
      throw new Error("No output generated due to stream error")
    }

    return fullResponse
  }

  export function registerAiHandler(
    instance: InstanceContext,
    bot: Chat,
    opts?: { prompt?: string; tools?: Record<string, any> },
  ): void {
    if (registeredBots.has(bot)) return

    // The bot's callbacks fire on the network, outside any instance scope, so
    // they re-enter the instance the bot was registered for.
    const directory = instance.directory

    ChatBot.registerMentionHandler(bot, async (thread, message) => {
      await withInstanceAsync({ directory }, () => handleMention(thread, message, opts))
    })

    ChatBot.registerMessageHandler(bot, async (thread, message) => {
      await withInstanceAsync({ directory }, () => handleMessage(thread, message, opts))
    })

    log.info("AI handler registered for bot")
    registeredBots.add(bot)
  }

  export async function ensureAiBot(
    instance: InstanceContext,
    name: string,
    config: Config.Connector,
  ): Promise<Chat | null> {
    const bot = await ChatBot.createBot(name, config)
    if (!bot) return null
    registerAiHandler(instance, bot)
    return bot
  }

  export async function initializeAllBots(instance: InstanceContext): Promise<void> {
    const config = await configGet()
    const connectors = config.connectors ?? {}

    for (const [name, connector] of Object.entries(connectors)) {
      if (typeof connector !== "object" || connector === null) continue
      if (!("type" in connector)) continue
      if (!["discord", "slack", "teams", "gchat", "linear", "github"].includes(connector.type)) continue
      if (connector.enabled === false) continue

      try {
        const bot = await ensureAiBot(instance, name, connector as Config.Connector)
        if (bot) {
          log.info("Bot initialized with AI handler", { name, platform: connector.type })
        }
      } catch (error) {
        log.error("Failed to initialize bot", { name, error })
      }
    }
  }
}
