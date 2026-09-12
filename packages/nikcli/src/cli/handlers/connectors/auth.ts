import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Connectors } from "@/connectors"
import { withInstanceAsync } from "@/effect"
import { configGet, connectorAuthUpdateToken, connectorAuthUpdateBotToken } from "./shared"
import type { ConnectorConfigured } from "./shared"

export default Runtime.handler(Commands.commands["connectors"].commands["auth"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    name: Option.getOrUndefined(input["name"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Connector Authentication")

      const config = await configGet()
      const connectors = config.connectors ?? {}

      const configuredConnectors = Object.entries(connectors).filter((entry): entry is [string, ConnectorConfigured] =>
        Connectors.isConnectorConfigured(entry[1]),
      )

      if (configuredConnectors.length === 0) {
        prompts.log.warn("No connectors configured")
        prompts.log.info("Add a connector first: nikcli connectors add")
        prompts.outro("Done")
        return
      }

      let connectorName = args.name
      if (!connectorName) {
        const options = configuredConnectors.map(([name, cfg]) => ({
          label: `${cfg.type} (${name})`,
          value: name,
        }))

        const selected = await prompts.select({
          message: "Select connector to authenticate",
          options,
        })
        if (prompts.isCancel(selected)) throw new UI.CancelledError()
        connectorName = selected
      }

      const connectorConfig = connectors[connectorName]
      if (!connectorConfig || !Connectors.isConnectorConfigured(connectorConfig)) {
        prompts.log.error(`Connector not found: ${connectorName}`)
        prompts.outro("Done")
        return
      }

      prompts.log.info(`Authenticating with ${connectorConfig.type}`)

      const spinner = prompts.spinner()
      spinner.start("Saving credentials...")

      try {
        switch (connectorConfig.type) {
          case "figma": {
            const token = await prompts.text({
              message: "Enter Figma personal access token",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (prompts.isCancel(token)) throw new UI.CancelledError()

            await connectorAuthUpdateToken(connectorName, token)
            spinner.stop("Figma token saved!")
            break
          }
          case "slack": {
            const botToken = await prompts.text({
              message: "Enter Slack bot token",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (prompts.isCancel(botToken)) throw new UI.CancelledError()

            await connectorAuthUpdateBotToken(connectorName, botToken)
            spinner.stop("Slack bot token saved!")
            break
          }
          case "github": {
            const token = await prompts.text({
              message: "Enter GitHub personal access token",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              placeholder: "ghp_xxxxxxxxxxxx",
            })
            if (prompts.isCancel(token)) throw new UI.CancelledError()

            await connectorAuthUpdateToken(connectorName, token)
            spinner.stop("GitHub token saved!")
            break
          }
          case "lovable": {
            const token = await prompts.text({
              message: "Enter Lovable API key",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (prompts.isCancel(token)) throw new UI.CancelledError()

            await connectorAuthUpdateToken(connectorName, token)
            spinner.stop("Lovable token saved!")
            break
          }
          case "discord": {
            const botToken = await prompts.text({
              message: "Enter Discord bot token",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (prompts.isCancel(botToken)) throw new UI.CancelledError()

            await connectorAuthUpdateBotToken(connectorName, botToken)
            spinner.stop("Discord bot token saved!")
            break
          }
          case "teams": {
            const botToken = await prompts.text({
              message: "Enter Microsoft Teams bot token",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (prompts.isCancel(botToken)) throw new UI.CancelledError()

            await connectorAuthUpdateBotToken(connectorName, botToken)
            spinner.stop("Teams bot token saved!")
            break
          }
          case "gchat": {
            const botToken = await prompts.text({
              message: "Enter Google Chat bot token",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (prompts.isCancel(botToken)) throw new UI.CancelledError()

            await connectorAuthUpdateBotToken(connectorName, botToken)
            spinner.stop("Google Chat bot token saved!")
            break
          }
          case "linear": {
            const botToken = await prompts.text({
              message: "Enter Linear bot token",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (prompts.isCancel(botToken)) throw new UI.CancelledError()

            await connectorAuthUpdateBotToken(connectorName, botToken)
            spinner.stop("Linear bot token saved!")
            break
          }
        }

        prompts.log.success(`Credentials saved for ${connectorName}`)
      } catch (error) {
        spinner.stop("Failed to save credentials", 1)
        prompts.log.error(error instanceof Error ? error.message : String(error))
      }

      prompts.outro("Done")
    }
  })
})
