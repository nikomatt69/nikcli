import { Hono, type Context } from "hono"
import { Log } from "../../util/log"
import { Config } from "../../config/config"
import { lazy } from "../../util/lazy"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

const log = Log.create({ service: "chatbot-routes" })

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, withCurrentInstance(effect))
}

async function getBotHandlers() {
  const mod = await import("../../chatbot/handlers")
  return mod.BotHandlers
}

type WebhookHandler = (request: Request) => Promise<void>

interface BotWebhooks {
  discord?: WebhookHandler
  slack?: WebhookHandler
  teams?: WebhookHandler
  gchat?: WebhookHandler
  linear?: WebhookHandler
  github?: WebhookHandler
}

interface BotInfo {
  webhooks: BotWebhooks
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

function createWebhookHandler(platform: string, webhookKey: keyof BotWebhooks) {
  return async (c: Context) => {
    const name = c.req.param("name")
    const connector = await getConnectorConfig(platform, name)

    if (!connector) {
      log.warn(`${platform} webhook: connector not found`, { name })
      return c.text("Connector not found", 404)
    }

    const BotHandlers = await getBotHandlers()
    const bot = (await BotHandlers.ensureAiBot(name, connector)) as BotInfo | undefined
    if (!bot) {
      log.warn(`${platform} webhook: bot not initialized`, { name })
      return c.text("Bot unavailable", 503)
    }

    try {
      const webhook = bot.webhooks[webhookKey]
      if (webhook) {
        await webhook(c.req.raw)
        return c.text("OK")
      }
      return c.text(`${platform.charAt(0).toUpperCase() + platform.slice(1)} webhook not configured`, 404)
    } catch (error) {
      log.error(`${platform} webhook error`, { name, error })
      return c.text("Error processing webhook", 500)
    }
  }
}

export const ChatBotRoutes = lazy(() => {
  const app = new Hono()

  app.post("/discord/:name", createWebhookHandler("discord", "discord"))
  app.post("/slack/:name", createWebhookHandler("slack", "slack"))
  app.post("/teams/:name", createWebhookHandler("teams", "teams"))
  app.post("/gchat/:name", createWebhookHandler("gchat", "gchat"))
  app.post("/linear/:name", createWebhookHandler("linear", "linear"))
  app.post("/github/:name", createWebhookHandler("github", "github"))

  return app
})
