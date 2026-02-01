import { dynamicTool, type Tool, jsonSchema } from "ai"
import z from "zod/v4"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { ConnectorAuth } from "./auth"
import { FigmaApi, getToken as getFigmaToken } from "./api/figma"
import { SlackApi, getBotToken as getSlackBotToken } from "./api/slack"
import { GithubApi, getToken as getGithubToken } from "./api/github"
import { LovableApi, getApiKey as getLovableApiKey } from "./api/lovable"
import { Flag } from "../flag/flag"

export namespace Connectors {
  const log = Log.create({ service: "connectors" })

  export const StatusSchema = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({ ref: "ConnectorStatusConnected" }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({ ref: "ConnectorStatusDisabled" }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({ ref: "ConnectorStatusFailed" }),
      z
        .object({
          status: z.literal("needs_auth"),
        })
        .meta({ ref: "ConnectorStatusNeedsAuth" }),
    ])
    .meta({ ref: "ConnectorStatus" })
  export type Status = z.infer<typeof StatusSchema>

  type ConnectorEntry = NonNullable<Config.Info["connectors"]>[string]
  export function isConnectorConfigured(entry: ConnectorEntry): entry is Config.Connector {
    return typeof entry === "object" && entry !== null && "type" in entry && typeof entry.type === "string"
  }

  function getRequiredCredentialType(type: string): "token" | "botToken" | "apiKey" | null {
    switch (type) {
      case "figma":
      case "github":
        return "token"
      case "slack":
        return "botToken"
      case "lovable":
        return "apiKey"
      default:
        return null
    }
  }

  async function resolveStatuses(): Promise<Record<string, Status>> {
    const cfg = await Config.get()
    const config = cfg.connectors ?? {}
    const statuses: Record<string, Status> = {}

    await Promise.all(
      Object.entries(config).map(async ([key, connector]) => {
        if (!isConnectorConfigured(connector)) {
          log.error("Ignoring connector config entry without type", { key })
          return
        }

        if (connector.enabled === false) {
          statuses[key] = { status: "disabled" }
          return
        }

        const result = await checkConnector(key, connector).catch(() => undefined)
        if (!result) return

        statuses[key] = result
      }),
    )

    return statuses
  }

  async function checkConnector(name: string, config: Config.Connector): Promise<Status> {
    try {
      switch (config.type) {
        case "figma": {
          const token = Flag.NIKCLI_FIGMA_TOKEN || config.token || (await getFigmaToken(name))
          if (!token) return { status: "needs_auth" }
          await FigmaApi.getMe(token)
          return { status: "connected" }
        }
        case "slack": {
          const botToken = Flag.NIKCLI_SLACK_BOT_TOKEN || config.botToken || (await getSlackBotToken(name))
          if (!botToken) return { status: "needs_auth" }
          await SlackApi.listUsers(botToken)
          return { status: "connected" }
        }
        case "github": {
          const token = Flag.NIKCLI_GITHUB_TOKEN || config.token || (await getGithubToken(name))
          if (!token) return { status: "needs_auth" }
          await GithubApi.getUser(token)
          return { status: "connected" }
        }
        case "lovable": {
          const apiKey = Flag.NIKCLI_LOVABLE_API_KEY || config.apiKey || (await getLovableApiKey(name))
          if (!apiKey) return { status: "needs_auth" }
          await LovableApi.getProjects(apiKey)
          return { status: "connected" }
        }
      }
      return { status: "failed", error: "Unknown connector type" }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: "failed", error: message }
    }
  }

  export async function status(): Promise<Record<string, Status>> {
    return resolveStatuses()
  }

  export async function hasStoredCredentials(name: string, type?: string): Promise<boolean> {
    const auth = await ConnectorAuth.get(name)
    if (!auth) return false
    if (!type) {
      return !!auth.token || !!auth.botToken || !!auth.apiKey
    }
    const requiredType = getRequiredCredentialType(type)
    if (!requiredType) return false
    switch (requiredType) {
      case "token":
        return !!auth.token
      case "botToken":
        return !!auth.botToken
      case "apiKey":
        return !!auth.apiKey
    }
    return false
  }

  function figmaTools(name: string, token: string): Record<string, Tool> {
    return {
      [`${name}_figma_get_file`]: dynamicTool({
        description: "Get the contents of a Figma file including all pages and frames",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            fileKey: {
              type: "string",
              description: "The Figma file key (found in Figma URL after /file/)",
            },
          },
          required: ["fileKey"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { fileKey: string }) => {
          const result = await FigmaApi.getFile(token, args.fileKey)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_figma_get_components`]: dynamicTool({
        description: "Get all components from a Figma file",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            fileKey: {
              type: "string",
              description: "The Figma file key",
            },
          },
          required: ["fileKey"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { fileKey: string }) => {
          const result = await FigmaApi.getFileComponents(token, args.fileKey)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_figma_get_styles`]: dynamicTool({
        description: "Get all styles from a Figma file",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            fileKey: {
              type: "string",
              description: "The Figma file key",
            },
          },
          required: ["fileKey"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { fileKey: string }) => {
          const result = await FigmaApi.getFileStyles(token, args.fileKey)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_figma_get_comments`]: dynamicTool({
        description: "Get all comments from a Figma file",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            fileKey: {
              type: "string",
              description: "The Figma file key",
            },
          },
          required: ["fileKey"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { fileKey: string }) => {
          const result = await FigmaApi.getComments(token, args.fileKey)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,
    }
  }

  function slackTools(name: string, botToken: string): Record<string, Tool> {
    return {
      [`${name}_slack_list_channels`]: dynamicTool({
        description: "List all channels in a Slack workspace",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            types: {
              type: "string",
              description: "Comma-separated channel types: public_channel, private_channel, mpim, im",
              default: "public_channel,private_channel",
            },
          },
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { types?: string }) => {
          const result = await SlackApi.listConversations(botToken, args.types)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_slack_send_message`]: dynamicTool({
        description: "Send a message to a Slack channel",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            channel: {
              type: "string",
              description: "The Slack channel ID (e.g., C01234567) or name (e.g., general)",
            },
            text: {
              type: "string",
              description: "The message text to send",
            },
          },
          required: ["channel", "text"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { channel: string; text: string }) => {
          const result = await SlackApi.sendMessage(botToken, args.channel, args.text)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_slack_search_messages`]: dynamicTool({
        description: "Search for messages in Slack",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
            count: {
              type: "number",
              description: "Maximum number of results (default 20)",
            },
          },
          required: ["query"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { query: string; count?: number }) => {
          const result = await SlackApi.searchMessages(botToken, args.query, args.count)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_slack_get_channel_info`]: dynamicTool({
        description: "Get information about a Slack channel",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            channel: {
              type: "string",
              description: "The Slack channel ID",
            },
          },
          required: ["channel"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { channel: string }) => {
          const result = await SlackApi.getConversationInfo(botToken, args.channel)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_slack_reply_to_thread`]: dynamicTool({
        description: "Reply to a message thread in Slack",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            channel: {
              type: "string",
              description: "The Slack channel ID",
            },
            threadTs: {
              type: "string",
              description: "The thread timestamp (ts) from the original message",
            },
            text: {
              type: "string",
              description: "The reply text",
            },
          },
          required: ["channel", "threadTs", "text"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { channel: string; threadTs: string; text: string }) => {
          const result = await SlackApi.replyToMessage(botToken, args.channel, args.threadTs, args.text)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,
    }
  }

  function githubTools(name: string, token: string): Record<string, Tool> {
    return {
      [`${name}_github_get_repo`]: dynamicTool({
        description: "Get information about a GitHub repository",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            owner: {
              type: "string",
              description: "Repository owner (username or organization)",
            },
            repo: {
              type: "string",
              description: "Repository name",
            },
          },
          required: ["owner", "repo"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { owner: string; repo: string }) => {
          const result = await GithubApi.getRepo(token, args.owner, args.repo)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_github_get_file`]: dynamicTool({
        description: "Get the contents of a file from a GitHub repository",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            owner: {
              type: "string",
              description: "Repository owner",
            },
            repo: {
              type: "string",
              description: "Repository name",
            },
            path: {
              type: "string",
              description: "Path to the file in the repository",
            },
            ref: {
              type: "string",
              description: "Branch, tag, or commit (optional)",
            },
          },
          required: ["owner", "repo", "path"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { owner: string; repo: string; path: string; ref?: string }) => {
          const content = await GithubApi.getFileContent(token, args.owner, args.repo, args.path)
          return content
        },
      }) as Tool,

      [`${name}_github_create_issue`]: dynamicTool({
        description: "Create a new issue in a GitHub repository",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            owner: {
              type: "string",
              description: "Repository owner",
            },
            repo: {
              type: "string",
              description: "Repository name",
            },
            title: {
              type: "string",
              description: "Issue title",
            },
            body: {
              type: "string",
              description: "Issue body (optional)",
            },
          },
          required: ["owner", "repo", "title"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { owner: string; repo: string; title: string; body?: string }) => {
          const result = await GithubApi.createIssue(token, args.owner, args.repo, args.title, args.body)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_github_list_issues`]: dynamicTool({
        description: "List issues in a GitHub repository",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            owner: {
              type: "string",
              description: "Repository owner",
            },
            repo: {
              type: "string",
              description: "Repository name",
            },
            state: {
              type: "string",
              enum: ["open", "closed", "all"],
              description: "Issue state (default: open)",
            },
          },
          required: ["owner", "repo"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { owner: string; repo: string; state?: "open" | "closed" | "all" }) => {
          const result = await GithubApi.listIssues(token, args.owner, args.repo, args.state)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_github_search_code`]: dynamicTool({
        description: "Search for code in GitHub",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query (supports GitHub code search syntax)",
            },
            sort: {
              type: "string",
              enum: ["indexed"],
              description: "Sort by",
            },
            order: {
              type: "string",
              enum: ["asc", "desc"],
              description: "Order direction",
            },
          },
          required: ["query"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { query: string; sort?: string; order?: "asc" | "desc" }) => {
          const result = await GithubApi.searchCode(token, args.query, args.sort, args.order)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_github_list_repos`]: dynamicTool({
        description: "List repositories for the authenticated user",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["all", "owner", "member"],
              description: "Repository type (default: owner)",
            },
            sort: {
              type: "string",
              enum: ["updated", "pushed", "full_name"],
              description: "Sort by",
            },
          },
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { type?: "all" | "owner" | "member"; sort?: "updated" | "pushed" | "full_name" }) => {
          const result = await GithubApi.listRepos(token, args.type, args.sort)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,
    }
  }

  function lovableTools(name: string, apiKey: string): Record<string, Tool> {
    return {
      [`${name}_lovable_get_projects`]: dynamicTool({
        description: "Get all Lovable projects",
        inputSchema: jsonSchema({
          type: "object",
          additionalProperties: false,
        }),
        execute: async () => {
          const result = await LovableApi.getProjects(apiKey)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_lovable_get_project`]: dynamicTool({
        description: "Get information about a Lovable project",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The Lovable project ID",
            },
          },
          required: ["projectId"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { projectId: string }) => {
          const result = await LovableApi.getProject(apiKey, args.projectId)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_lovable_get_chats`]: dynamicTool({
        description: "Get all chats for a Lovable project",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The Lovable project ID",
            },
          },
          required: ["projectId"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { projectId: string }) => {
          const result = await LovableApi.getChats(apiKey, args.projectId)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_lovable_send_message`]: dynamicTool({
        description: "Send a message to a Lovable project",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The Lovable project ID",
            },
            message: {
              type: "string",
              description: "The message to send",
            },
            chatId: {
              type: "string",
              description: "Existing chat ID (optional, creates new chat if not provided)",
            },
          },
          required: ["projectId", "message"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { projectId: string; message: string; chatId?: string }) => {
          const result = await LovableApi.sendMessage(apiKey, args.projectId, args.message, args.chatId)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_lovable_get_project_files`]: dynamicTool({
        description: "Get all files in a Lovable project",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The Lovable project ID",
            },
          },
          required: ["projectId"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { projectId: string }) => {
          const result = await LovableApi.getProjectFiles(apiKey, args.projectId)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,

      [`${name}_lovable_run_prompt`]: dynamicTool({
        description: "Run a prompt in a Lovable project",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The Lovable project ID",
            },
            prompt: {
              type: "string",
              description: "The prompt to run",
            },
          },
          required: ["projectId", "prompt"],
          additionalProperties: false,
        }),
        // @ts-expect-error - Tool execute function type mismatch
        execute: async (args: { projectId: string; prompt: string }) => {
          const result = await LovableApi.runPrompt(apiKey, args.projectId, args.prompt)
          return JSON.stringify(result, null, 2)
        },
      }) as Tool,
    }
  }

  export async function tools(): Promise<Record<string, Tool>> {
    const cfg = await Config.get()
    const config = cfg.connectors ?? {}
    const tools: Record<string, Tool> = {}

    await Promise.all(
      Object.entries(config).map(async ([name, connector]) => {
        if (!isConnectorConfigured(connector)) return
        if (connector.enabled === false) return

        try {
          switch (connector.type) {
            case "figma": {
              const token = Flag.NIKCLI_FIGMA_TOKEN || connector.token || (await getFigmaToken(name))
              if (!token) return
              Object.assign(tools, figmaTools(name, token))
              break
            }
            case "slack": {
              const botToken = Flag.NIKCLI_SLACK_BOT_TOKEN || connector.botToken || (await getSlackBotToken(name))
              if (!botToken) return
              Object.assign(tools, slackTools(name, botToken))
              break
            }
            case "github": {
              const token = Flag.NIKCLI_GITHUB_TOKEN || connector.token || (await getGithubToken(name))
              if (!token) return
              Object.assign(tools, githubTools(name, token))
              break
            }
            case "lovable": {
              const apiKey = Flag.NIKCLI_LOVABLE_API_KEY || connector.apiKey || (await getLovableApiKey(name))
              if (!apiKey) return
              Object.assign(tools, lovableTools(name, apiKey))
              break
            }
          }
        } catch (error) {
          log.error("Failed to load connector tools", { name, connector: connector.type, error })
        }
      }),
    )

    return tools
  }

  type ConnectorPrompt = {
    name: string
    description: string
    type: string
    arguments?: Array<{ name: string; description: string }>
  }

  export async function prompts(): Promise<Record<string, ConnectorPrompt & { client: string }>> {
    const cfg = await Config.get()
    const config = cfg.connectors ?? {}
    const connectorStatuses = await status()

    const prompts: Record<string, ConnectorPrompt & { client: string }> = {}

    for (const [connectorName, connector] of Object.entries(config)) {
      if (!isConnectorConfigured(connector)) continue
      if (connector.enabled === false) continue

      const connStatus = connectorStatuses[connectorName]
      if (connStatus?.status !== "connected") continue

      switch (connector.type) {
        case "figma": {
          prompts[`${connectorName}_figma_file`] = {
            name: `${connectorName}_figma_file`,
            description: "Get Figma file contents",
            type: "figma",
            arguments: [{ name: "fileKey", description: "Figma file key" }],
            client: connectorName,
          }
          prompts[`${connectorName}_figma_components`] = {
            name: `${connectorName}_figma_components`,
            description: "Get Figma file components",
            type: "figma",
            arguments: [{ name: "fileKey", description: "Figma file key" }],
            client: connectorName,
          }
          prompts[`${connectorName}_figma_comments`] = {
            name: `${connectorName}_figma_comments`,
            description: "Get Figma file comments",
            type: "figma",
            arguments: [{ name: "fileKey", description: "Figma file key" }],
            client: connectorName,
          }
          break
        }
        case "slack": {
          prompts[`${connectorName}_slack_channels`] = {
            name: `${connectorName}_slack_channels`,
            description: "List Slack channels",
            type: "slack",
            client: connectorName,
          }
          prompts[`${connectorName}_slack_message`] = {
            name: `${connectorName}_slack_message`,
            description: "Send Slack message",
            type: "slack",
            arguments: [
              { name: "channel", description: "Channel ID" },
              { name: "text", description: "Message text" },
            ],
            client: connectorName,
          }
          prompts[`${connectorName}_slack_search`] = {
            name: `${connectorName}_slack_search`,
            description: "Search Slack messages",
            type: "slack",
            arguments: [{ name: "query", description: "Search query" }],
            client: connectorName,
          }
          break
        }
        case "github": {
          prompts[`${connectorName}_github_repo`] = {
            name: `${connectorName}_github_repo`,
            description: "Get GitHub repository info",
            type: "github",
            arguments: [
              { name: "owner", description: "Repository owner" },
              { name: "repo", description: "Repository name" },
            ],
            client: connectorName,
          }
          prompts[`${connectorName}_github_issues`] = {
            name: `${connectorName}_github_issues`,
            description: "List GitHub issues",
            type: "github",
            arguments: [
              { name: "owner", description: "Repository owner" },
              { name: "repo", description: "Repository name" },
            ],
            client: connectorName,
          }
          prompts[`${connectorName}_github_code`] = {
            name: `${connectorName}_github_code`,
            description: "Search GitHub code",
            type: "github",
            arguments: [{ name: "query", description: "Search query" }],
            client: connectorName,
          }
          break
        }
        case "lovable": {
          prompts[`${connectorName}_lovable_projects`] = {
            name: `${connectorName}_lovable_projects`,
            description: "List Lovable projects",
            type: "lovable",
            client: connectorName,
          }
          prompts[`${connectorName}_lovable_chats`] = {
            name: `${connectorName}_lovable_chats`,
            description: "Get Lovable project chats",
            type: "lovable",
            arguments: [{ name: "projectId", description: "Project ID" }],
            client: connectorName,
          }
          prompts[`${connectorName}_lovable_message`] = {
            name: `${connectorName}_lovable_message`,
            description: "Send message to Lovable project",
            type: "lovable",
            arguments: [
              { name: "projectId", description: "Project ID" },
              { name: "message", description: "Message" },
            ],
            client: connectorName,
          }
          break
        }
      }
    }

    return prompts
  }
}
