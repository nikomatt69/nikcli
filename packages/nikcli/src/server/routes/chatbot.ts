import { Hono, type Context } from "hono"
import { ChatbotWebhook } from "../../chatbot/webhook"
import { lazy } from "../../util/lazy"

function createWebhookHandler(platform: ChatbotWebhook.Platform) {
  return async (c: Context) => {
    // Every registration below binds :name, but the handler takes a bare
    // Context so hono types the param as optional.
    const name = c.req.param("name")!
    const result = await ChatbotWebhook.handle(platform, name, c.req.raw)
    return c.text(result.body, result.status as 200)
  }
}

export const ChatBotRoutes = lazy(() => {
  const app = new Hono()

  app.post("/discord/:name", createWebhookHandler("discord"))
  app.post("/slack/:name", createWebhookHandler("slack"))
  app.post("/teams/:name", createWebhookHandler("teams"))
  app.post("/gchat/:name", createWebhookHandler("gchat"))
  app.post("/linear/:name", createWebhookHandler("linear"))
  app.post("/github/:name", createWebhookHandler("github"))

  return app
})
