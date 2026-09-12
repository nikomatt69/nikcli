import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Connectors } from "@/connectors"
import { withInstanceAsync } from "@/effect"
import { configGet } from "./shared"
import type { ConnectorConfigured } from "./shared"

export default Runtime.handler(Commands.commands["connectors"].commands["list"], async (_input) => {
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Connectors")

      const config = await configGet()
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
    }
  })
})
