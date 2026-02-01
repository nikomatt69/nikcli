import { Tool } from "./tool"
import { FigmaApi, getToken as getFigmaToken } from "../connectors/api/figma"
import { SlackApi, getBotToken as getSlackBotToken } from "../connectors/api/slack"
import { GithubApi, getToken as getGithubToken } from "../connectors/api/github"
import { LovableApi, getApiKey as getLovableApiKey } from "../connectors/api/lovable"
import { Flag } from "../flag/flag"
import { Config } from "../config/config"
import z from "zod"

export const UseConnectorTool = Tool.define("use_connector", async () => {
  return {
    description: "Execute operations on external services (Figma, Slack, GitHub, Lovable)",
    parameters: z.object({
      connector: z.string().describe("Connector name"),
      operation: z
        .enum([
          "figma_get_file",
          "figma_get_components",
          "figma_get_styles",
          "figma_get_comments",
          "slack_list_channels",
          "slack_send_message",
          "slack_search_messages",
          "slack_get_channel_info",
          "slack_reply_to_thread",
          "github_get_repo",
          "github_get_file",
          "github_create_issue",
          "github_list_issues",
          "github_search_code",
          "github_list_repos",
          "lovable_get_projects",
          "lovable_get_project",
          "lovable_get_chats",
          "lovable_send_message",
          "lovable_get_project_files",
          "lovable_run_prompt",
        ])
        .describe("Operation to perform"),
      args: z.record(z.string(), z.any()).describe("Operation arguments"),
    }),
    async execute({ connector, operation, args }) {
      const config = await Config.get()
      const connectorConfig = config.connectors?.[connector]

      if (!connectorConfig || typeof connectorConfig !== "object" || !("type" in connectorConfig)) {
        throw new Error(`Connector "${connector}" not found`)
      }

      let result: any

      switch (connectorConfig.type) {
        case "figma": {
          const token = Flag.NIKCLI_FIGMA_TOKEN || connectorConfig.token || (await getFigmaToken(connector))
          if (!token) throw new Error(`No token for connector "${connector}"`)
          switch (operation) {
            case "figma_get_file":
              result = await FigmaApi.getFile(token, args.fileKey as string)
              break
            case "figma_get_components":
              result = await FigmaApi.getFileComponents(token, args.fileKey as string)
              break
            case "figma_get_styles":
              result = await FigmaApi.getFileStyles(token, args.fileKey as string)
              break
            case "figma_get_comments":
              result = await FigmaApi.getComments(token, args.fileKey as string)
              break
            default:
              throw new Error(`Unknown operation: ${operation}`)
          }
          break
        }
        case "slack": {
          const botToken = Flag.NIKCLI_SLACK_BOT_TOKEN || connectorConfig.botToken || (await getSlackBotToken(connector))
          if (!botToken) throw new Error(`No bot token for connector "${connector}"`)
          switch (operation) {
            case "slack_list_channels":
              result = await SlackApi.listConversations(botToken, args.types as string | undefined)
              break
            case "slack_send_message":
              result = await SlackApi.sendMessage(botToken, args.channel as string, args.text as string)
              break
            case "slack_search_messages":
              result = await SlackApi.searchMessages(botToken, args.query as string, args.count as number | undefined)
              break
            case "slack_get_channel_info":
              result = await SlackApi.getConversationInfo(botToken, args.channel as string)
              break
            case "slack_reply_to_thread":
              result = await SlackApi.replyToMessage(
                botToken,
                args.channel as string,
                args.threadTs as string,
                args.text as string,
              )
              break
            default:
              throw new Error(`Unknown operation: ${operation}`)
          }
          break
        }
        case "github": {
          const token = Flag.NIKCLI_GITHUB_TOKEN || connectorConfig.token || (await getGithubToken(connector))
          if (!token) throw new Error(`No token for connector "${connector}"`)
          switch (operation) {
            case "github_get_repo":
              result = await GithubApi.getRepo(token, args.owner as string, args.repo as string)
              break
            case "github_get_file":
              result = await GithubApi.getFileContent(
                token,
                args.owner as string,
                args.repo as string,
                args.path as string,
              )
              break
            case "github_create_issue":
              result = await GithubApi.createIssue(
                token,
                args.owner as string,
                args.repo as string,
                args.title as string,
                args.body as string | undefined,
              )
              break
            case "github_list_issues":
              result = await GithubApi.listIssues(
                token,
                args.owner as string,
                args.repo as string,
                args.state as "open" | "closed" | "all" | undefined,
              )
              break
            case "github_search_code":
              result = await GithubApi.searchCode(
                token,
                args.query as string,
                args.sort as string | undefined,
                args.order as "asc" | "desc" | undefined,
              )
              break
            case "github_list_repos":
              result = await GithubApi.listRepos(
                token,
                args.type as "all" | "owner" | "member" | undefined,
                args.sort as "updated" | "pushed" | "full_name" | undefined,
              )
              break
            default:
              throw new Error(`Unknown operation: ${operation}`)
          }
          break
        }
        case "lovable": {
          const apiKey = Flag.NIKCLI_LOVABLE_API_KEY || connectorConfig.apiKey || (await getLovableApiKey(connector))
          if (!apiKey) throw new Error(`No API key for connector "${connector}"`)
          switch (operation) {
            case "lovable_get_projects":
              result = await LovableApi.getProjects(apiKey)
              break
            case "lovable_get_project":
              result = await LovableApi.getProject(apiKey, args.projectId as string)
              break
            case "lovable_get_chats":
              result = await LovableApi.getChats(apiKey, args.projectId as string)
              break
            case "lovable_send_message":
              result = await LovableApi.sendMessage(
                apiKey,
                args.projectId as string,
                args.message as string,
                args.chatId as string | undefined,
              )
              break
            case "lovable_get_project_files":
              result = await LovableApi.getProjectFiles(apiKey, args.projectId as string)
              break
            case "lovable_run_prompt":
              result = await LovableApi.runPrompt(apiKey, args.projectId as string, args.prompt as string)
              break
          }
          break
        }
      }

      return {
        title: `${connector} ${operation}`,
        metadata: {},
        output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
      }!
    },
  }
})
