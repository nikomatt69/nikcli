import { Runtime } from "../../../framework/runtime"
import { Commands } from "../../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { withInstanceAsync } from "@/effect"
import { configGet, mcpGetAuthStatus, getAuthStatusIcon, getAuthStatusText, isMcpRemote } from "../shared"
import type { McpRemote } from "../shared"

export default Runtime.handler(Commands.commands["mcp"].commands["auth"].commands["list"], async (_input) => {
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("MCP OAuth Status")

      const config = await configGet()
      const mcpServers = config.mcp ?? {}

      const oauthServers = Object.entries(mcpServers).filter(
        (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
      )

      if (oauthServers.length === 0) {
        prompts.log.warn("No OAuth-capable MCP servers configured")
        prompts.outro("Done")
        return
      }

      for (const [name, serverConfig] of oauthServers) {
        const authStatus = await mcpGetAuthStatus(name)
        const icon = getAuthStatusIcon(authStatus)
        const statusText = getAuthStatusText(authStatus)
        const url = serverConfig.url

        prompts.log.info(`${icon} ${name} ${UI.Style.TEXT_DIM}${statusText}\n    ${UI.Style.TEXT_DIM}${url}`)
      }

      prompts.outro(`${oauthServers.length} OAuth-capable server(s)`)
    }
  })
})
