import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Config } from "@/config/config"
import { Global } from "@nikcli-ai/util/global"
import { withInstanceAsync } from "@/effect"
import { connectorAuthUpdateToken, connectorAuthUpdateBotToken, resolveConfigPath, addConnectorToConfig } from "./shared"

export default Runtime.handler(Commands.commands["connectors"].commands["add"], async (_input) => {
  
  await withInstanceAsync({ directory: process.cwd() }, async (instance) => {
    {
      UI.empty()
      prompts.intro("Add Connector")

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
        message: "Enter connector name",
        validate: (x) => {
          if (!x || x.length === 0) return "Required"
          if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(x)) return "Must be alphanumeric (letters, numbers, _, -)"
          return undefined
        },
      })
      if (prompts.isCancel(name)) throw new UI.CancelledError()

      const type = await prompts.select({
        message: "Select service type",
        options: [
          { label: "Figma", value: "figma", hint: "Design files and components" },
          { label: "Slack", value: "slack", hint: "Messages and channels" },
          { label: "GitHub", value: "github", hint: "Repositories and issues" },
          { label: "Lovable", value: "lovable", hint: "AI projects and chats" },
          { label: "Discord Bot", value: "discord", hint: "Discord server bot" },
          { label: "Microsoft Teams", value: "teams", hint: "Teams bot" },
          { label: "Google Chat", value: "gchat", hint: "Google Chat bot" },
          { label: "Linear", value: "linear", hint: "Linear issue bot" },
        ],
      })
      if (prompts.isCancel(type)) throw new UI.CancelledError()

      const enabled = await prompts.confirm({
        message: "Enable connector immediately?",
        initialValue: true,
      })
      if (prompts.isCancel(enabled)) throw new UI.CancelledError()

      let connectorConfig: Config.Connector
      let hasCredentials = false

      switch (type) {
        case "figma": {
          const tokenResult = await prompts.text({
            message: "Enter Figma personal access token (or press enter to skip)",
          })
          if (prompts.isCancel(tokenResult)) throw new UI.CancelledError()

          connectorConfig = {
            type: "figma",
            enabled,
          }
          if (tokenResult && tokenResult.trim()) {
            await addConnectorToConfig(name, connectorConfig, configPath)
            await connectorAuthUpdateToken(name, tokenResult.trim())
            hasCredentials = true
          }
          break
        }
        case "slack": {
          const botTokenResult = await prompts.text({
            message: "Enter Slack bot token (or press enter to skip)",
          })
          if (prompts.isCancel(botTokenResult)) throw new UI.CancelledError()

          connectorConfig = {
            type: "slack",
            enabled,
          }
          if (botTokenResult && botTokenResult.trim()) {
            await addConnectorToConfig(name, connectorConfig, configPath)
            await connectorAuthUpdateBotToken(name, botTokenResult.trim())
            hasCredentials = true
          }
          break
        }
        case "github": {
          const tokenResult = await prompts.text({
            message: "Enter GitHub personal access token (or press enter to skip)",
          })
          if (prompts.isCancel(tokenResult)) throw new UI.CancelledError()

          connectorConfig = {
            type: "github",
            enabled,
          }
          if (tokenResult && tokenResult.trim()) {
            await addConnectorToConfig(name, connectorConfig, configPath)
            await connectorAuthUpdateToken(name, tokenResult.trim())
            hasCredentials = true
          }
          break
        }
        case "lovable": {
          const tokenResult = await prompts.text({
            message: "Enter Lovable API key (or press enter to skip)",
          })
          if (prompts.isCancel(tokenResult)) throw new UI.CancelledError()

          connectorConfig = {
            type: "lovable",
            enabled,
          }
          if (tokenResult && tokenResult.trim()) {
            await addConnectorToConfig(name, connectorConfig, configPath)
            await connectorAuthUpdateToken(name, tokenResult.trim())
            hasCredentials = true
          }
          break
        }
        case "discord": {
          const botTokenResult = await prompts.text({
            message: "Enter Discord bot token (or press enter to skip)",
          })
          if (prompts.isCancel(botTokenResult)) throw new UI.CancelledError()

          connectorConfig = {
            type: "discord",
            enabled,
          }
          if (botTokenResult && botTokenResult.trim()) {
            await addConnectorToConfig(name, connectorConfig, configPath)
            await connectorAuthUpdateBotToken(name, botTokenResult.trim())
            hasCredentials = true
          }
          break
        }
        case "teams": {
          const botTokenResult = await prompts.text({
            message: "Enter Microsoft Teams bot token (or press enter to skip)",
          })
          if (prompts.isCancel(botTokenResult)) throw new UI.CancelledError()

          connectorConfig = {
            type: "teams",
            enabled,
          }
          if (botTokenResult && botTokenResult.trim()) {
            await addConnectorToConfig(name, connectorConfig, configPath)
            await connectorAuthUpdateBotToken(name, botTokenResult.trim())
            hasCredentials = true
          }
          break
        }
        case "gchat": {
          const botTokenResult = await prompts.text({
            message: "Enter Google Chat bot token (or press enter to skip)",
          })
          if (prompts.isCancel(botTokenResult)) throw new UI.CancelledError()

          connectorConfig = {
            type: "gchat",
            enabled,
          }
          if (botTokenResult && botTokenResult.trim()) {
            await addConnectorToConfig(name, connectorConfig, configPath)
            await connectorAuthUpdateBotToken(name, botTokenResult.trim())
            hasCredentials = true
          }
          break
        }
        case "linear": {
          const botTokenResult = await prompts.text({
            message: "Enter Linear bot token (or press enter to skip)",
          })
          if (prompts.isCancel(botTokenResult)) throw new UI.CancelledError()

          connectorConfig = {
            type: "linear",
            enabled,
          }
          if (botTokenResult && botTokenResult.trim()) {
            await addConnectorToConfig(name, connectorConfig, configPath)
            await connectorAuthUpdateBotToken(name, botTokenResult.trim())
            hasCredentials = true
          }
          break
        }
        default:
          prompts.log.error("Unknown connector type")
          prompts.outro("Done")
          return
      }

      if (!hasCredentials) {
        await addConnectorToConfig(name, connectorConfig, configPath)
        prompts.log.success(`Connector "${name}" added to ${configPath}`)
        prompts.log.info(`Authenticate with: nikcli connectors auth ${name}`)
      } else {
        prompts.log.success(`Connector "${name}" added to ${configPath}`)
      }

      prompts.outro("Connector added successfully")
    }
  })
})
