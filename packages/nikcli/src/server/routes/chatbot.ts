import { Hono } from "hono"
import { Log } from "../../util/log"
import { Config } from "../../config/config"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "chatbot-routes" })

async function getBotHandlers() {
  const mod = await import("../../chatbot/handlers")
  return mod.BotHandlers
}

export const ChatBotRoutes = lazy(() => {
  const app = new Hono()

  async function getConnectorConfig(platform: string, name: string) {
    const config = await Config.get()
    const connector = config.connectors?.[name]
    if (!connector || typeof connector !== "object") return null
    if ("type" in connector && connector.type !== platform) return null
    return connector as Config.Connector | undefined
  }

  app.post("/discord/:name", async (c) => {
    const name = c.req.param("name")
    const connector = await getConnectorConfig("discord", name)

    if (!connector) {
      log.warn("Discord webhook: connector not found", { name })
      return c.text("Connector not found", 404)
    }

    const BotHandlers = await getBotHandlers()
    const bot = await BotHandlers.ensureAiBot(name, connector)
    if (!bot) {
      log.warn("Discord webhook: bot not initialized", { name })
      return c.text("Bot unavailable", 503)
    }

    try {
      const webhooks = bot.webhooks
      const discordWebhook = webhooks.discord
      if (discordWebhook) {
        await discordWebhook(c.req.raw)
        return c.text("OK")
      }
      return c.text("Discord webhook not configured", 404)
    } catch (error) {
      log.error("Discord webhook error", { name, error })
      return c.text("Error processing webhook", 500)
    }
  })

  app.post("/slack/:name", async (c) => {
    const name = c.req.param("name")
    const connector = await getConnectorConfig("slack", name)

    if (!connector) {
      log.warn("Slack webhook: connector not found", { name })
      return c.text("Connector not found", 404)
    }

    const BotHandlers = await getBotHandlers()
    const bot = await BotHandlers.ensureAiBot(name, connector)
    if (!bot) {
      log.warn("Slack webhook: bot not initialized", { name })
      return c.text("Bot unavailable", 503)
    }

    try {
      const webhooks = bot.webhooks
      const slackWebhook = webhooks.slack
      if (slackWebhook) {
        await slackWebhook(c.req.raw)
        return c.text("OK")
      }
      return c.text("Slack webhook not configured", 404)
    } catch (error) {
      log.error("Slack webhook error", { name, error })
      return c.text("Error processing webhook", 500)
    }
  })

  app.post("/teams/:name", async (c) => {
    const name = c.req.param("name")
    const connector = await getConnectorConfig("teams", name)

    if (!connector) {
      log.warn("Teams webhook: connector not found", { name })
      return c.text("Connector not found", 404)
    }

    const BotHandlers = await getBotHandlers()
    const bot = await BotHandlers.ensureAiBot(name, connector)
    if (!bot) {
      log.warn("Teams webhook: bot not initialized", { name })
      return c.text("Bot unavailable", 503)
    }

    try {
      const webhooks = bot.webhooks
      const teamsWebhook = webhooks.teams
      if (teamsWebhook) {
        await teamsWebhook(c.req.raw)
        return c.text("OK")
      }
      return c.text("Teams webhook not configured", 404)
    } catch (error) {
      log.error("Teams webhook error", { name, error })
      return c.text("Error processing webhook", 500)
    }
  })

  app.post("/gchat/:name", async (c) => {
    const name = c.req.param("name")
    const connector = await getConnectorConfig("gchat", name)

    if (!connector) {
      log.warn("GChat webhook: connector not found", { name })
      return c.text("Connector not found", 404)
    }

    const BotHandlers = await getBotHandlers()
    const bot = await BotHandlers.ensureAiBot(name, connector)
    if (!bot) {
      log.warn("GChat webhook: bot not initialized", { name })
      return c.text("Bot unavailable", 503)
    }

    try {
      const webhooks = bot.webhooks
      const gchatWebhook = webhooks.gchat
      if (gchatWebhook) {
        await gchatWebhook(c.req.raw)
        return c.text("OK")
      }
      return c.text("Google Chat webhook not configured", 404)
    } catch (error) {
      log.error("GChat webhook error", { name, error })
      return c.text("Error processing webhook", 500)
    }
  })

  app.post("/linear/:name", async (c) => {
    const name = c.req.param("name")
    const connector = await getConnectorConfig("linear", name)

    if (!connector) {
      log.warn("Linear webhook: connector not found", { name })
      return c.text("Connector not found", 404)
    }

    const BotHandlers = await getBotHandlers()
    const bot = await BotHandlers.ensureAiBot(name, connector)
    if (!bot) {
      log.warn("Linear webhook: bot not initialized", { name })
      return c.text("Bot unavailable", 503)
    }

    try {
      const webhooks = bot.webhooks
      const linearWebhook = webhooks.linear
      if (linearWebhook) {
        await linearWebhook(c.req.raw)
        return c.text("OK")
      }
      return c.text("Linear webhook not configured", 404)
    } catch (error) {
      log.error("Linear webhook error", { name, error })
      return c.text("Error processing webhook", 500)
    }
  })

  app.post("/github/:name", async (c) => {
    const name = c.req.param("name")
    const connector = await getConnectorConfig("github", name)

    if (!connector) {
      log.warn("GitHub webhook: connector not found", { name })
      return c.text("Connector not found", 404)
    }

    const BotHandlers = await getBotHandlers()
    const bot = await BotHandlers.ensureAiBot(name, connector)
    if (!bot) {
      log.warn("GitHub webhook: bot not initialized", { name })
      return c.text("Bot unavailable", 503)
    }

    try {
      const webhooks = bot.webhooks
      const githubWebhook = webhooks.github
      if (githubWebhook) {
        await githubWebhook(c.req.raw)
        return c.text("OK")
      }
      return c.text("GitHub webhook not configured", 404)
    } catch (error) {
      log.error("GitHub webhook error", { name, error })
      return c.text("Error processing webhook", 500)
    }
  })

  return app
})
