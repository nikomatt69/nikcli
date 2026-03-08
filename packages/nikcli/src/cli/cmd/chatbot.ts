import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Connectors } from "../../connectors"
import { ConnectorAuth } from "../../connectors/auth"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { modify, applyEdits } from "jsonc-parser"
import { Global } from "../../global"
import { Server } from "../../server/server"
import path from "path"

type ConnectorConfigured = Config.Connector

async function getChatBot() {
  const mod = await import("../../chatbot")
  return mod.ChatBot
}

function isChatPlatform(type: string): boolean {
  return ["discord", "slack", "teams", "gchat", "linear", "github"].includes(type)
}

async function resolveConfigPath(baseDir: string, global = false) {
  const candidates = [path.join(baseDir, "nikcli.json"), path.join(baseDir, "nikcli.jsonc")]

  if (!global) {
    candidates.push(path.join(baseDir, ".nikcli", "nikcli.json"), path.join(baseDir, ".nikcli", "nikcli.jsonc"))
  }

  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      return candidate
    }
  }

  return path.join(baseDir, "nikcli.json")
}

async function addConnectorToConfig(name: string, connectorConfig: Config.Connector, configPath: string) {
  const file = Bun.file(configPath)

  let text = "{}"
  if (await file.exists()) {
    text = await file.text()
  }

  const edits = modify(text, ["connectors", name], connectorConfig, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const result = applyEdits(text, edits)

  await Bun.write(configPath, result)

  return configPath
}

export const BotCommand = cmd({
  command: "bot",
  describe: "manage chat bots (Discord, Slack, Teams, Google Chat, Linear, GitHub)",
  builder: (yargs) =>
    yargs
      .command(BotListCommand)
      .command(BotAddCommand)
      .command(BotStartCommand)
      .command(BotStopCommand)
      .command(BotWebhookCommand)
      .demandCommand(),
  async handler() {},
})

export const BotListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list configured chat bots and their status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Chat Bots")

        const config = await Config.get()
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
      },
    })
  },
})

export const BotAddCommand = cmd({
  command: "add",
  describe: "add a new chat bot",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add Chat Bot")

        const project = Instance.project

        const [projectConfigPath, globalConfigPath] = await Promise.all([
          resolveConfigPath(Instance.worktree),
          resolveConfigPath(Global.Path.config, true),
        ])

        let configPath = globalConfigPath
        if (project.vcs === "git") {
          const scopeResult = await prompts.select({
            message: "Location",
            options: [
              {
                label: "Current project",
                value: projectConfigPath,
                hint: projectConfigPath,
              },
              {
                label: "Global",
                value: globalConfigPath,
                hint: globalConfigPath,
              },
            ],
          })
          if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
          configPath = scopeResult
        }

        const name = await prompts.text({
          message: "Enter bot name",
          validate: (x) => {
            if (!x || x.length === 0) return "Required"
            if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(x)) return "Must be alphanumeric"
            return undefined
          },
        })
        if (prompts.isCancel(name)) throw new UI.CancelledError()

        const type = await prompts.select({
          message: "Select platform",
          options: [
            { label: "Discord", value: "discord", hint: "Discord server bot" },
            { label: "Slack", value: "slack", hint: "Slack workspace bot" },
            { label: "Microsoft Teams", value: "teams", hint: "Teams bot" },
            { label: "Google Chat", value: "gchat", hint: "Google Chat bot" },
            { label: "Linear", value: "linear", hint: "Linear issue bot" },
            { label: "GitHub", value: "github", hint: "GitHub bot" },
          ],
        })
        if (prompts.isCancel(type)) throw new UI.CancelledError()

        const enabled = await prompts.confirm({
          message: "Enable bot immediately?",
          initialValue: true,
        })
        if (prompts.isCancel(enabled)) throw new UI.CancelledError()

        let connectorConfig: Config.Connector
        let hasCredentials = false

        const botTokenResult = await prompts.text({
          message: "Enter bot token (or press enter to skip)",
        })
        if (prompts.isCancel(botTokenResult)) throw new UI.CancelledError()

        connectorConfig = {
          type: type as "discord" | "slack" | "teams" | "gchat" | "linear" | "github",
          botToken: botTokenResult?.trim() || undefined,
          enabled,
        }

        if (botTokenResult && botTokenResult.trim()) {
          await addConnectorToConfig(name, connectorConfig, configPath)
          await ConnectorAuth.updateBotToken(name, botTokenResult.trim())
          hasCredentials = true
        } else {
          await addConnectorToConfig(name, connectorConfig, configPath)
        }

        if (!hasCredentials) {
          prompts.log.success(`Bot "${name}" added to ${configPath}`)
          prompts.log.info(`Authenticate with: nikcli connectors auth ${name}`)
        } else {
          prompts.log.success(`Bot "${name}" added to ${configPath}`)
        }

        prompts.outro("Bot added successfully")
      },
    })
  },
})

export const BotStartCommand = cmd({
  command: "start [name]",
  describe: "start a chat bot",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the bot to start",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Start Chat Bot")

        const config = await Config.get()
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
          const bot = await ChatBot.createBot(botName, connectorConfig)
          if (!bot) {
            spinner.stop("Failed to create bot", 1)
            prompts.log.error("Check credentials: nikcli connectors auth " + botName)
            prompts.outro("Done")
            return
          }

          spinner.stop(`Bot "${botName}" started!`)
          prompts.log.info(`Webhook URL: ${Server.url().origin}/chatbot/${connectorConfig.type}/${botName}`)
        } catch (error) {
          spinner.stop("Failed to start bot", 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
        }

        prompts.outro("Done")
      },
    })
  },
})

export const BotStopCommand = cmd({
  command: "stop [name]",
  describe: "stop a running chat bot",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the bot to stop",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Stop Chat Bot")

        const ChatBot = await getChatBot()
        const runningBots = Array.from(ChatBot.getAllBots().keys())

        if (runningBots.length === 0) {
          prompts.log.warn("No running bots")
          prompts.outro("Done")
          return
        }

        let botName = args.name
        if (!botName) {
          const selected = await prompts.select({
            message: "Select bot to stop",
            options: runningBots.map((name) => ({
              label: name,
              value: name,
            })),
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          botName = selected
        }

        const removed = ChatBot.removeBot(botName)
        if (removed) {
          prompts.log.success(`Bot "${botName}" stopped`)
        } else {
          prompts.log.error(`Bot "${botName}" not found`)
        }

        prompts.outro("Done")
      },
    })
  },
})

export const BotWebhookCommand = cmd({
  command: "webhook [name]",
  describe: "show webhook URL for a bot",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the bot",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Chat Bot Webhook")

        const config = await Config.get()
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
      },
    })
  },
})
