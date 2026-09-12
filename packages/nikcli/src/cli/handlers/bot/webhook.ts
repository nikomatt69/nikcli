import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Connectors } from "@/connectors"
import { Server } from "@/server/server"
import { withInstanceAsync } from "@/effect"
import { configGet, getChatBot, isChatPlatform } from "./shared"
import type { ConnectorConfigured } from "./shared"

export default Runtime.handler(Commands.commands["bot"].commands["webhook"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Chat Bot Webhook")

      const config = await configGet()
      const connectors = config.connectors ?? {}

      const chatBots = Object.entries(connectors).filter(
        (entry): entry is [string, ConnectorConfigured] =>
          Connectors.isConnectorConfigured(entry[1]) && isChatPlatform(entry[1].type),
      )

      if (chatBots.length === 0) {
        prompts.log.warn("No chat bots configured")
        prompts.outro("Done")
        return
      }

      let botName = args.name
      if (!botName) {
        const selected = await prompts.select({
          message: "Select bot",
          options: chatBots.map(([name, cfg]) => ({
            label: `${name} (${cfg.type})`,
            value: name,
          })),
        })
        if (prompts.isCancel(selected)) throw new UI.CancelledError()
        botName = selected
      }

      const connectorConfig = connectors[botName]
      if (!connectorConfig || !Connectors.isConnectorConfigured(connectorConfig)) {
        prompts.log.error(`Bot not found: ${botName}`)
        prompts.outro("Done")
        return
      }

      const ChatBot = await getChatBot()
      const webhookPath = ChatBot.getWebhookPath(
        connectorConfig.type as "discord" | "slack" | "teams" | "gchat" | "linear" | "github",
        botName,
      )
      const webhookUrl = `${Server.url().origin}${webhookPath}`

      prompts.log.success(`Webhook URL for "${botName}":`)
      prompts.log.info(webhookUrl)
      prompts.log.info("\nConfigure this URL in your " + connectorConfig.type + " app settings.")

      prompts.outro("Done")
    }
  })
})
