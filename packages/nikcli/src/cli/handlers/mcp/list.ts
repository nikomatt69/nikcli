import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { withInstanceAsync } from "@/effect"
import { configGet, mcpStatus, mcpHasStoredTokens, isMcpConfigured, isMcpRemote } from "./shared"
import type { McpConfigured } from "./shared"

export default Runtime.handler(Commands.commands["mcp"].commands["list"], async (_input) => {
  
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("MCP Servers")

      const config = await configGet()
      const mcpServers = config.mcp ?? {}
      const statuses = await mcpStatus()

      const servers = Object.entries(mcpServers).filter((entry): entry is [string, McpConfigured] =>
        isMcpConfigured(entry[1]),
      )

      if (servers.length === 0) {
        prompts.log.warn("No MCP servers configured")
        prompts.outro("Add servers with: nikcli mcp add")
        return
      }

      for (const [name, serverConfig] of servers) {
        const status = statuses[name]
        const hasOAuth = isMcpRemote(serverConfig) && !!serverConfig.oauth
        const hasStoredTokens = await mcpHasStoredTokens(name)

        let statusIcon: string
        let statusText: string
        let hint = ""

        if (!status) {
          statusIcon = "○"
          statusText = "not initialized"
        } else if (status.status === "connected") {
          statusIcon = "✓"
          statusText = "connected"
          if (hasOAuth && hasStoredTokens) {
            hint = " (OAuth)"
          }
        } else if (status.status === "disabled") {
          statusIcon = "○"
          statusText = "disabled"
        } else if (status.status === "needs_auth") {
          statusIcon = "⚠"
          statusText = "needs authentication"
        } else if (status.status === "needs_client_registration") {
          statusIcon = "✗"
          statusText = "needs client registration"
          hint = "\n    " + status.error
        } else {
          statusIcon = "✗"
          statusText = "failed"
          hint = "\n    " + status.error
        }

        const typeHint = serverConfig.type === "remote" ? serverConfig.url : serverConfig.command.join(" ")
        prompts.log.info(
          `${statusIcon} ${name} ${UI.Style.TEXT_DIM}${statusText}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`,
        )
      }

      prompts.outro(`${servers.length} server(s)`)
    }
  })
})
