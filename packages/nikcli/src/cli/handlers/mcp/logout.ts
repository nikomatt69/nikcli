import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { McpAuth } from "@/mcp/auth"
import { Effect } from "effect"
import { withInstanceAsync } from "@/effect"
import { runMcpAuth, mcpRemoveAuth } from "./shared"

export default Runtime.handler(Commands.commands["mcp"].commands["logout"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    name: Option.getOrUndefined(input["name"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("MCP OAuth Logout")

      const credentials = await runMcpAuth(
        Effect.gen(function* () {
          const auth = yield* McpAuth.Service
          return yield* auth.all()
        }),
      )
      const serverNames = Object.keys(credentials)

      if (serverNames.length === 0) {
        prompts.log.warn("No MCP OAuth credentials stored")
        prompts.outro("Done")
        return
      }

      let serverName = args.name
      if (!serverName) {
        const selected = await prompts.select({
          message: "Select MCP server to logout",
          options: serverNames.map((name) => {
            const entry = credentials[name]
            const hasTokens = !!entry.tokens
            const hasClient = !!entry.clientInfo
            let hint = ""
            if (hasTokens && hasClient) hint = "tokens + client"
            else if (hasTokens) hint = "tokens"
            else if (hasClient) hint = "client registration"
            return {
              label: name,
              value: name,
              hint,
            }
          }),
        })
        if (prompts.isCancel(selected)) throw new UI.CancelledError()
        serverName = selected
      }

      if (!credentials[serverName]) {
        prompts.log.error(`No credentials found for: ${serverName}`)
        prompts.outro("Done")
        return
      }

      await mcpRemoveAuth(serverName)
      prompts.log.success(`Removed OAuth credentials for ${serverName}`)
      prompts.outro("Done")
    }
  })
})
