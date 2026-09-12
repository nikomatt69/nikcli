import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Connectors } from "@/connectors"
import { withInstanceAsync } from "@/effect"
import { configGet, getChatBot, isChatPlatform } from "./shared"
import type { ConnectorConfigured } from "./shared"

export default Runtime.handler(Commands.commands["bot"].commands["list"], async (_input) => {
  
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Chat Bots")

      const config = await configGet()
      const connectors = config.connectors ?? {}

      const items = Object.entries(connectors).filter(
        (entry): entry is [string, ConnectorConfigured] =>
          Connectors.isConnectorConfigured(entry[1]) && isChatPlatform(entry[1].type),
      )

      if (items.length === 0) {
        prompts.log.warn("No chat bots configured")
        prompts.log.info("Add a bot with: nikcli bot add")
        prompts.outro("Done")
        return
      }

      const ChatBot = await getChatBot()
      const bot = ChatBot.getAllBots()

      for (const [name, connectorConfig] of items) {
        const isRunning = bot.has(name)
        const webhookPath = ChatBot.getWebhookPath(
          connectorConfig.type as "discord" | "slack" | "teams" | "gchat" | "linear" | "github",
          name,
        )

        prompts.log.info(
          `${isRunning ? "●" : "○"} ${name} ${UI.Style.TEXT_DIM}${connectorConfig.type}${UI.Style.TEXT_NORMAL}\n    Webhook: ${webhookPath}`,
        )
      }

      prompts.outro(`${items.length} bot(s)`)
    }
  })
})
