import { Chat, type Thread, type Message } from "chat"
import { ChatBot } from "./index"
import { streamText, type ModelMessage } from "ai"
import { Provider } from "../provider/provider"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { SystemPrompt } from "../session/system"
import { Plugin } from "../plugin"
import { clone } from "remeda"
import { Instance } from "../project/instance"

const log = Log.create({ service: "chatbot-handlers" })

export namespace BotHandlers {
  const DEFAULT_PROMPT = `You are nikcli, an AI coding assistant. You help users with software engineering tasks including writing code, debugging, answering questions, and more. Be concise and helpful.`

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
    customTools?: Record<string, any>,
  ): Promise<string> {
    const modelInfo = await Provider.defaultModel()
    const model = await Provider.getModel(modelInfo.providerID, modelInfo.modelID)

    const language = await Provider.getLanguage(model)

    const sessionID = `chatbot-${Date.now()}`

    // Build system parts array for plugin transformation (mirrors llm.ts pattern)
    const systemParts = [...SystemPrompt.header(model.providerID), customPrompt || DEFAULT_PROMPT].filter(Boolean)

    const original = clone(systemParts)
    await Plugin.trigger("experimental.chat.system.transform", { sessionID }, { system: systemParts })
    if (systemParts.length === 0) {
      systemParts.push(...original)
    }

    const messages: ModelMessage[] = [{ role: "user", content: userMessage }]

    const result = await streamText({
      model: language,
      system: systemParts.join("\n"),
      messages,
    })

    let fullResponse = ""
    for await (const chunk of result.textStream) {
      fullResponse += chunk
    }

    return fullResponse
  }

  export function registerAiHandler(bot: Chat, opts?: { prompt?: string; tools?: Record<string, any> }): void {
    // Capture the current Instance directory so async handlers can re-establish context
    const directory = Instance.directory

    ChatBot.registerMentionHandler(bot, async (thread, message) => {
      await Instance.provide({
        directory,
        fn: () => handleMention(thread, message, opts),
      })
    })

    ChatBot.registerMessageHandler(bot, async (thread, message) => {
      await Instance.provide({
        directory,
        fn: () => handleMessage(thread, message, opts),
      })
    })

    log.info("AI handler registered for bot")
  }

  export async function initializeAllBots(): Promise<void> {
    const config = await Config.get()
    const connectors = config.connectors ?? {}

    for (const [name, connector] of Object.entries(connectors)) {
      if (typeof connector !== "object" || connector === null) continue
      if (!("type" in connector)) continue
      if (!["discord", "slack", "teams", "gchat", "linear", "github"].includes(connector.type)) continue
      if (connector.enabled === false) continue

      try {
        const bot = await ChatBot.createBot(name, connector as Config.Connector)
        if (bot) {
          registerAiHandler(bot)
          log.info("Bot initialized with AI handler", { name, platform: connector.type })
        }
      } catch (error) {
        log.error("Failed to initialize bot", { name, error })
      }
    }
  }
}
