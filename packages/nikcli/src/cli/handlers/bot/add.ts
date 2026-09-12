import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Config } from "@/config/config"
import { Global } from "@nikcli-ai/util/global"
import { withInstanceAsync } from "@/effect"
import { connectorAuthUpdateBotToken, resolveConfigPath, addConnectorToConfig } from "./shared"

export default Runtime.handler(Commands.commands["bot"].commands["add"], async (_input) => {
  
  await withInstanceAsync({ directory: process.cwd() }, async (instance) => {
    {
      UI.empty()
      prompts.intro("Add Chat Bot")

      const project = instance.project

      const [projectConfigPath, globalConfigPath] = await Promise.all([
        resolveConfigPath(instance.worktree),
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
        await connectorAuthUpdateBotToken(name, botTokenResult.trim())
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
    }
  })
})
