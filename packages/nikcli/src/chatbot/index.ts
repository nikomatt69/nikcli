import { Chat, type Adapter, type Thread, type Message } from "chat"
import { createDiscordAdapter } from "@chat-adapter/discord"
import { createSlackAdapter } from "@chat-adapter/slack"
import { createTeamsAdapter } from "@chat-adapter/teams"
import { createGoogleChatAdapter } from "@chat-adapter/gchat"
import { createLinearAdapter } from "@chat-adapter/linear"
import { createGitHubAdapter } from "@chat-adapter/github"
import { createMemoryState } from "@chat-adapter/state-memory"
import { Config } from "../config/config"
import { resolveCredential } from "../connectors/credentials"
import { Log } from "../util/log"

export namespace ChatBot {
  const log = Log.create({ service: "chatbot" })

  const bots = new Map<string, Chat>()

  const CHAT_SDK_PLATFORMS = ["discord", "slack", "teams", "gchat", "linear", "github"] as const
  type ChatPlatform = (typeof CHAT_SDK_PLATFORMS)[number]

  export type BotConfig = {
    name: string
    platform: ChatPlatform
    enabled: boolean
  }

  export function isChatPlatform(type: string): type is ChatPlatform {
    return CHAT_SDK_PLATFORMS.includes(type as ChatPlatform)
  }

  export async function createBot(name: string, config: Config.Connector): Promise<Chat | null> {
    if (!isChatPlatform(config.type)) {
      log.warn("Invalid chat platform", { type: config.type, name })
      return null
    }

    const existing = bots.get(name)
    if (existing) return existing

    const credential = await resolveCredential(name, config)
    if (!credential) {
      log.warn("No credential for bot", { name, type: config.type })
      return null
    }

    const adapter = createAdapter(config.type, credential)
    if (!adapter) {
      log.warn("Failed to create adapter", { type: config.type, name })
      return null
    }

    const bot = new Chat({
      userName: `nikcli-${name}`,
      adapters: { [config.type]: adapter },
      state: createMemoryState(),
      logger: "info",
    })

    bots.set(name, bot)
    log.info("Bot created", { name, platform: config.type })

    return bot
  }

  function createAdapter(platform: ChatPlatform, credential: string): Adapter | null {
    switch (platform) {
      case "discord":
        return createDiscordAdapter({ botToken: credential })
      case "slack":
        return createSlackAdapter({ botToken: credential })
      case "teams":
        return createTeamsAdapter({ appId: credential, appPassword: credential })
      case "gchat":
        try {
          const creds = JSON.parse(credential)
          return createGoogleChatAdapter({ credentials: creds })
        } catch {
          return createGoogleChatAdapter()
        }
      case "linear":
        return createLinearAdapter({ accessToken: credential })
      case "github":
        return createGitHubAdapter({ token: credential })
      default:
        return null
    }
  }

  export function getBot(name: string): Chat | undefined {
    return bots.get(name)
  }

  export function getAllBots(): Map<string, Chat> {
    return bots
  }

  export function removeBot(name: string): boolean {
    return bots.delete(name)
  }

  export function registerMentionHandler(
    bot: Chat,
    handler: (thread: Thread, message: Message) => Promise<void>,
  ): void {
    bot.onNewMention(async (thread, message) => {
      await handler(thread, message)
    })
  }

  export function registerMessageHandler(
    bot: Chat,
    handler: (thread: Thread, message: Message) => Promise<void>,
  ): void {
    bot.onSubscribedMessage(async (thread, message) => {
      await handler(thread, message)
    })
  }

  export function registerPatternHandler(
    bot: Chat,
    pattern: RegExp,
    handler: (thread: Thread, message: Message) => Promise<void>,
  ): void {
    bot.onNewMessage(pattern, async (thread, message) => {
      await handler(thread, message)
    })
  }

  export function getWebhookPath(platform: ChatPlatform, connectorName: string): string {
    return `/chatbot/${platform}/${connectorName}`
  }
}
