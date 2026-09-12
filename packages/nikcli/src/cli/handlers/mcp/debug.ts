import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { mcpSdk } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { McpOAuthProvider } from "@/mcp/oauth-provider"
import { Installation } from "@/installation"
import { Effect } from "effect"
import { withInstanceAsync } from "@/effect"
import { runMcpAuth, configGet, mcpGetAuthStatus, getAuthStatusIcon, getAuthStatusText, isMcpRemote } from "./shared"

export default Runtime.handler(Commands.commands["mcp"].commands["debug"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": input["name"],
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("MCP OAuth Debug")

      const config = await configGet()
      const mcpServers = config.mcp ?? {}
      const serverName = args.name

      const serverConfig = mcpServers[serverName]
      if (!serverConfig) {
        prompts.log.error(`MCP server not found: ${serverName}`)
        prompts.outro("Done")
        return
      }

      if (!isMcpRemote(serverConfig)) {
        prompts.log.error(`MCP server ${serverName} is not a remote server`)
        prompts.outro("Done")
        return
      }

      if (serverConfig.oauth === false) {
        prompts.log.warn(`MCP server ${serverName} has OAuth explicitly disabled`)
        prompts.outro("Done")
        return
      }

      prompts.log.info(`Server: ${serverName}`)
      prompts.log.info(`URL: ${serverConfig.url}`)

      const authStatus = await mcpGetAuthStatus(serverName)
      prompts.log.info(`Auth status: ${getAuthStatusIcon(authStatus)} ${getAuthStatusText(authStatus)}`)

      const entry = await runMcpAuth(
        Effect.gen(function* () {
          const auth = yield* McpAuth.Service
          return yield* auth.get(serverName)
        }),
      )
      if (entry?.tokens) {
        prompts.log.info(`  Access token: ${entry.tokens.accessToken.substring(0, 20)}...`)
        if (entry.tokens.expiresAt) {
          const expiresDate = new Date(entry.tokens.expiresAt * 1000)
          const isExpired = entry.tokens.expiresAt < Date.now() / 1000
          prompts.log.info(`  Expires: ${expiresDate.toISOString()} ${isExpired ? "(EXPIRED)" : ""}`)
        }
        if (entry.tokens.refreshToken) {
          prompts.log.info(`  Refresh token: present`)
        }
      }
      if (entry?.clientInfo) {
        prompts.log.info(`  Client ID: ${entry.clientInfo.clientId}`)
        if (entry.clientInfo.clientSecretExpiresAt) {
          const expiresDate = new Date(entry.clientInfo.clientSecretExpiresAt * 1000)
          prompts.log.info(`  Client secret expires: ${expiresDate.toISOString()}`)
        }
      }

      const spinner = prompts.spinner()
      spinner.start("Testing connection...")

      try {
        const response = await fetch(serverConfig.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "nikcli-debug", version: Installation.VERSION },
            },
            id: 1,
          }),
        })

        spinner.stop(`HTTP response: ${response.status} ${response.statusText}`)

        const wwwAuth = response.headers.get("www-authenticate")
        if (wwwAuth) {
          prompts.log.info(`WWW-Authenticate: ${wwwAuth}`)
        }

        if (response.status === 401) {
          prompts.log.warn("Server returned 401 Unauthorized")

          const oauthConfig = typeof serverConfig.oauth === "object" ? serverConfig.oauth : undefined
          const authProvider = new McpOAuthProvider(
            serverName,
            serverConfig.url,
            {
              clientId: oauthConfig?.clientId,
              clientSecret: oauthConfig?.clientSecret,
              scope: oauthConfig?.scope,
            },
            {
              onRedirect: async () => {},
            },
          )

          prompts.log.info("Testing OAuth flow (without completing authorization)...")

          const transport = new (mcpSdk().StreamableHTTPClientTransport)(new URL(serverConfig.url), {
            authProvider,
          })

          try {
            const client = new (mcpSdk().Client)({
              name: "nikcli-debug",
              version: Installation.VERSION,
            })
            await client.connect(transport)
            prompts.log.success("Connection successful (already authenticated)")
            await client.close()
          } catch (error) {
            if (error instanceof mcpSdk().UnauthorizedError) {
              prompts.log.info(`OAuth flow triggered: ${error.message}`)

              const clientInfo = await authProvider.clientInformation()
              if (clientInfo) {
                prompts.log.info(`Client ID available: ${clientInfo.client_id}`)
              } else {
                prompts.log.info("No client ID - dynamic registration will be attempted")
              }
            } else {
              prompts.log.error(`Connection error: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
        } else if (response.status >= 200 && response.status < 300) {
          prompts.log.success("Server responded successfully (no auth required or already authenticated)")
          const body = await response.text()
          try {
            const json = JSON.parse(body)
            if (json.result?.serverInfo) {
              prompts.log.info(`Server info: ${JSON.stringify(json.result.serverInfo)}`)
            }
          } catch {}
        } else {
          prompts.log.warn(`Unexpected status: ${response.status}`)
          const body = await response.text().catch(() => "")
          if (body) {
            prompts.log.info(`Response body: ${body.substring(0, 500)}`)
          }
        }
      } catch (error) {
        spinner.stop("Connection failed", 1)
        prompts.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }

      prompts.outro("Debug complete")
    }
  })
})
