import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Connectors } from "../../connectors"
import { ConnectorAuth } from "../../connectors/auth"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { modify, applyEdits } from "jsonc-parser"
import { Global } from "../../global"
import path from "path"

type ConnectorConfigured = Config.Connector

function getConnectorIcon(status: Connectors.Status): string {
  switch (status.status) {
    case "connected":
      return "✓"
    case "disabled":
      return "○"
    case "needs_auth":
      return "⚠"
    case "failed":
      return "✗"
  }
}

function getConnectorText(status: Connectors.Status): string {
  switch (status.status) {
    case "connected":
      return "connected"
    case "disabled":
      return "disabled"
    case "needs_auth":
      return "needs authentication"
    case "failed":
      return "failed"
  }
}

export const ConnectorsCommand = cmd({
  command: "connectors",
  describe: "manage external service connectors (Figma, Slack, GitHub, Lovable)",
  builder: (yargs) =>
    yargs
      .command(ConnectorsListCommand)
      .command(ConnectorsAddCommand)
      .command(ConnectorsAuthCommand)
      .command(ConnectorsLogoutCommand)
      .demandCommand(),
  async handler() {},
})

export const ConnectorsListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list configured connectors and their status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Connectors")

        const config = await Config.get()
        const connectors = config.connectors ?? {}
        const statuses = await Connectors.status()

        const items = Object.entries(connectors).filter((entry): entry is [string, ConnectorConfigured] =>
          Connectors.isConnectorConfigured(entry[1]),
        )

        if (items.length === 0) {
          prompts.log.warn("No connectors configured")
          prompts.outro("Add connectors with: nikcli connectors add")
          return
        }

        for (const [name, connectorConfig] of items) {
          const status = statuses[name]
          const hasStoredCredentials = await Connectors.hasStoredCredentials(name, connectorConfig.type)

          let statusIcon: string
          let statusText: string
          let hint = ""

          if (!status) {
            statusIcon = "○"
            statusText = "not initialized"
          } else if (status.status === "connected") {
            statusIcon = "✓"
            statusText = "connected"
            if (hasStoredCredentials) {
              hint = " (saved credentials)"
            }
          } else if (status.status === "disabled") {
            statusIcon = "○"
            statusText = "disabled"
          } else if (status.status === "needs_auth") {
            statusIcon = "⚠"
            statusText = "needs authentication"
            hint = "\n    Set token with: nikcli connectors auth " + name
          } else {
            statusIcon = "✗"
            statusText = "failed"
            hint = "\n    " + status.error
          }

          const typeHint = `${connectorConfig.type}`
          prompts.log.info(
            `${statusIcon} ${name} ${UI.Style.TEXT_DIM}${statusText}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`,
          )
        }

        prompts.outro(`${items.length} connector(s)`)
      },
    })
  },
})

export const ConnectorsAuthCommand = cmd({
  command: "auth [name]",
  describe: "authenticate with a connector",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the connector",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Connector Authentication")

        const config = await Config.get()
        const connectors = config.connectors ?? {}

        const configuredConnectors = Object.entries(connectors).filter(
          (entry): entry is [string, ConnectorConfigured] => Connectors.isConnectorConfigured(entry[1]),
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

              await ConnectorAuth.updateToken(connectorName, token)
              spinner.stop("Figma token saved!")
              break
            }
            case "slack": {
              const botToken = await prompts.text({
                message: "Enter Slack bot token",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(botToken)) throw new UI.CancelledError()

              await ConnectorAuth.updateBotToken(connectorName, botToken)
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

              await ConnectorAuth.updateToken(connectorName, token)
              spinner.stop("GitHub token saved!")
              break
            }
            case "lovable": {
              const token = await prompts.text({
                message: "Enter Lovable API key",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(token)) throw new UI.CancelledError()

              await ConnectorAuth.updateToken(connectorName, token)
              spinner.stop("Lovable token saved!")
              break
            }
            case "discord": {
              const botToken = await prompts.text({
                message: "Enter Discord bot token",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(botToken)) throw new UI.CancelledError()

              await ConnectorAuth.updateBotToken(connectorName, botToken)
              spinner.stop("Discord bot token saved!")
              break
            }
            case "teams": {
              const botToken = await prompts.text({
                message: "Enter Microsoft Teams bot token",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(botToken)) throw new UI.CancelledError()

              await ConnectorAuth.updateBotToken(connectorName, botToken)
              spinner.stop("Teams bot token saved!")
              break
            }
            case "gchat": {
              const botToken = await prompts.text({
                message: "Enter Google Chat bot token",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(botToken)) throw new UI.CancelledError()

              await ConnectorAuth.updateBotToken(connectorName, botToken)
              spinner.stop("Google Chat bot token saved!")
              break
            }
            case "linear": {
              const botToken = await prompts.text({
                message: "Enter Linear bot token",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(botToken)) throw new UI.CancelledError()

              await ConnectorAuth.updateBotToken(connectorName, botToken)
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
      },
    })
  },
})

export const ConnectorsLogoutCommand = cmd({
  command: "logout [name]",
  describe: "remove credentials for a connector",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the connector",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Connector Logout")

        const credentials = await ConnectorAuth.all()
        const connectorNames = Object.keys(credentials)

        if (connectorNames.length === 0) {
          prompts.log.warn("No connector credentials stored")
          prompts.outro("Done")
          return
        }

        let connectorName = args.name
        if (!connectorName) {
          const selected = await prompts.select({
            message: "Select connector to logout",
            options: connectorNames.map((name) => ({
              label: name,
              value: name,
            })),
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          connectorName = selected
        }

        if (!credentials[connectorName]) {
          prompts.log.error(`No credentials found for: ${connectorName}`)
          prompts.outro("Done")
          return
        }

        await ConnectorAuth.remove(connectorName)
        prompts.log.success(`Removed credentials for ${connectorName}`)
        prompts.outro("Done")
      },
    })
  },
})

async function resolveConfigPath(baseDir: string, global = false) {
  const candidates = [path.join(baseDir, "nikcli.json")]

  if (!global) {
    candidates.push(path.join(baseDir, ".nikcli", "nikcli.json"))
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

export const ConnectorsAddCommand = cmd({
  command: "add",
  describe: "add a connector",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add Connector")

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
              await ConnectorAuth.updateToken(name, tokenResult.trim())
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
              await ConnectorAuth.updateBotToken(name, botTokenResult.trim())
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
              await ConnectorAuth.updateToken(name, tokenResult.trim())
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
              await ConnectorAuth.updateToken(name, tokenResult.trim())
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
              await ConnectorAuth.updateBotToken(name, botTokenResult.trim())
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
              await ConnectorAuth.updateBotToken(name, botTokenResult.trim())
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
              await ConnectorAuth.updateBotToken(name, botTokenResult.trim())
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
              await ConnectorAuth.updateBotToken(name, botTokenResult.trim())
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
      },
    })
  },
})
