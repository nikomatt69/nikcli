import { Effect } from "effect"
import { Config } from "../config/config"
import { runPromiseWithLayer, withCurrentInstance } from "../effect"
import { Log } from "@nikcli-ai/util/log"
import type { InstanceContext } from "@/effect"

/**
 * Platform-webhook core shared by the Hono `/chatbot` routes and the Effect
 * HttpApi bridge. Webhook receivers need the raw `Request` (signature
 * verification reads the raw body) and reply with plain-text bodies, so both
 * transports delegate here and only differ in how they wrap the result.
 */
export namespace ChatbotWebhook {
  const log = Log.create({ service: "chatbot.webhook" })

  export type Platform = "discord" | "slack" | "teams" | "gchat" | "linear" | "github"

  export interface Result {
    body: string
    status: number
  }

  type WebhookHandler = (request: Request) => Promise<void>

  interface BotInfo {
    webhooks: Partial<Record<Platform, WebhookHandler>>
  }

  function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
    return runPromiseWithLayer(Config.defaultLayer, withCurrentInstance(effect))
  }

  async function getBotHandlers() {
    const mod = await import("./handlers")
    return mod.BotHandlers
  }

  async function getConnectorConfig(platform: string, name: string) {
    const config = await runConfig(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )
    const connector = config.connectors?.[name]
    if (!connector || typeof connector !== "object") return null
    if ("type" in connector && connector.type !== platform) return null
    return connector as Config.Connector | undefined
  }

  export async function handle(
    instance: InstanceContext,
    platform: Platform,
    name: string,
    request: Request,
  ): Promise<Result> {
    const connector = await getConnectorConfig(platform, name)

    if (!connector) {
      log.warn(`${platform} webhook: connector not found`, { name })
      return { body: "Connector not found", status: 404 }
    }

    const BotHandlers = await getBotHandlers()
    const bot = (await BotHandlers.ensureAiBot(instance, name, connector)) as BotInfo | undefined
    if (!bot) {
      log.warn(`${platform} webhook: bot not initialized`, { name })
      return { body: "Bot unavailable", status: 503 }
    }

    try {
      const webhook = bot.webhooks[platform]
      if (webhook) {
        await webhook(request)
        return { body: "OK", status: 200 }
      }
      return {
        body: `${platform.charAt(0).toUpperCase() + platform.slice(1)} webhook not configured`,
        status: 404,
      }
    } catch (error) {
      log.error(`${platform} webhook error`, { name, error })
      return { body: "Error processing webhook", status: 500 }
    }
  }
}
