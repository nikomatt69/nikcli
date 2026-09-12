import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Connectors } from "@/connectors"
import { Server } from "@/server/server"
import { withInstanceAsync } from "@/effect"
import { configGet, getChatBot, getBotHandlers, isChatPlatform } from "./shared"
import type { ConnectorConfigured } from "./shared"

export default Runtime.handler(Commands.commands["bot"].commands["start"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    name: Option.getOrUndefined(input["name"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async (instance) => {
    {
      UI.empty()
      prompts.intro("Start Chat Bot")

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
          message: "Select bot to start",
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
      const spinner = prompts.spinner()
      spinner.start(`Starting bot "${botName}"...`)

      try {
        const BotHandlers = await getBotHandlers()
        const bot = await BotHandlers.ensureAiBot(instance, botName, connectorConfig)
        if (!bot) {
          spinner.stop("Failed to create bot", 1)
          prompts.log.error("Check credentials: nikcli connectors auth " + botName)
          prompts.outro("Done")
          return
        }

        const webhookPath = ChatBot.getWebhookPath(
          connectorConfig.type as "discord" | "slack" | "teams" | "gchat" | "linear" | "github",
          botName,
        )
        spinner.stop(`Bot "${botName}" started!`)
        prompts.log.info(`Webhook URL: ${Server.url().origin}${webhookPath}`)
      } catch (error) {
        spinner.stop("Failed to start bot", 1)
        prompts.log.error(error instanceof Error ? error.message : String(error))
      }

      prompts.outro("Done")
    }
  })
})
