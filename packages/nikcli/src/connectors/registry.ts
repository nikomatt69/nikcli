import { dynamicTool, type Tool, jsonSchema } from "ai"
import { Config } from "../config/config"
import { resolveCredential } from "./credentials"
import { FigmaApi } from "./api/figma"
import { SlackApi } from "./api/slack"
import { GithubApi } from "./api/github"
import { LovableApi } from "./api/lovable"

export interface OperationArg {
  name: string
  description: string
  required?: boolean
  type?: "string" | "number" | "boolean"
  enum?: string[]
}

export interface OperationSpec {
  name: string
  description: string
  args: OperationArg[]
  execute: (credential: string, args: Record<string, any>) => Promise<any>
}

export interface ConnectorSpec {
  type: string
  credentialType: "token" | "botToken" | "apiKey"
  operations: OperationSpec[]
  healthCheck: (credential: string) => Promise<void>
}

const FIGMA_OPERATIONS: OperationSpec[] = [
  {
    name: "figma_get_file",
    description: "Get the contents of a Figma file including all pages and frames",
    args: [{ name: "fileKey", description: "The Figma file key (found in Figma URL after /file/)", required: true }],
    execute: (cred, args) => FigmaApi.getFile(cred, args.fileKey),
  },
  {
    name: "figma_get_components",
    description: "Get all components from a Figma file",
    args: [{ name: "fileKey", description: "The Figma file key", required: true }],
    execute: (cred, args) => FigmaApi.getFileComponents(cred, args.fileKey),
  },
  {
    name: "figma_get_styles",
    description: "Get all styles from a Figma file",
    args: [{ name: "fileKey", description: "The Figma file key", required: true }],
    execute: (cred, args) => FigmaApi.getFileStyles(cred, args.fileKey),
  },
  {
    name: "figma_get_comments",
    description: "Get all comments from a Figma file",
    args: [{ name: "fileKey", description: "The Figma file key", required: true }],
    execute: (cred, args) => FigmaApi.getComments(cred, args.fileKey),
  },
]

const SLACK_OPERATIONS: OperationSpec[] = [
  {
    name: "slack_list_channels",
    description: "List all channels in a Slack workspace",
    args: [
      {
        name: "types",
        description: "Comma-separated channel types: public_channel, private_channel, mpim, im",
        type: "string",
      },
    ],
    execute: (cred, args) => SlackApi.listConversations(cred, args.types),
  },
  {
    name: "slack_send_message",
    description: "Send a message to a Slack channel",
    args: [
      {
        name: "channel",
        description: "The Slack channel ID (e.g., C01234567) or name (e.g., general)",
        required: true,
      },
      { name: "text", description: "The message text to send", required: true },
    ],
    execute: (cred, args) => SlackApi.sendMessage(cred, args.channel, args.text),
  },
  {
    name: "slack_search_messages",
    description: "Search for messages in Slack",
    args: [
      { name: "query", description: "The search query", required: true },
      { name: "count", description: "Maximum number of results (default 20)", type: "number" },
    ],
    execute: (cred, args) => SlackApi.searchMessages(cred, args.query, args.count),
  },
  {
    name: "slack_get_channel_info",
    description: "Get information about a Slack channel",
    args: [{ name: "channel", description: "The Slack channel ID", required: true }],
    execute: (cred, args) => SlackApi.getConversationInfo(cred, args.channel),
  },
  {
    name: "slack_reply_to_thread",
    description: "Reply to a message thread in Slack",
    args: [
      { name: "channel", description: "The Slack channel ID", required: true },
      { name: "threadTs", description: "The thread timestamp (ts) from the original message", required: true },
      { name: "text", description: "The reply text", required: true },
    ],
    execute: (cred, args) => SlackApi.replyToMessage(cred, args.channel, args.threadTs, args.text),
  },
]

const GITHUB_OPERATIONS: OperationSpec[] = [
  {
    name: "github_get_repo",
    description: "Get information about a GitHub repository",
    args: [
      { name: "owner", description: "Repository owner (username or organization)", required: true },
      { name: "repo", description: "Repository name", required: true },
    ],
    execute: (cred, args) => GithubApi.getRepo(cred, args.owner, args.repo),
  },
  {
    name: "github_get_file",
    description: "Get the contents of a file from a GitHub repository",
    args: [
      { name: "owner", description: "Repository owner", required: true },
      { name: "repo", description: "Repository name", required: true },
      { name: "path", description: "Path to the file in the repository", required: true },
      { name: "ref", description: "Branch, tag, or commit (optional)", type: "string" },
    ],
    execute: (cred, args) => GithubApi.getFileContent(cred, args.owner, args.repo, args.path),
  },
  {
    name: "github_create_issue",
    description: "Create a new issue in a GitHub repository",
    args: [
      { name: "owner", description: "Repository owner", required: true },
      { name: "repo", description: "Repository name", required: true },
      { name: "title", description: "Issue title", required: true },
      { name: "body", description: "Issue body (optional)", type: "string" },
    ],
    execute: (cred, args) => GithubApi.createIssue(cred, args.owner, args.repo, args.title, args.body),
  },
  {
    name: "github_list_issues",
    description: "List issues in a GitHub repository",
    args: [
      { name: "owner", description: "Repository owner", required: true },
      { name: "repo", description: "Repository name", required: true },
      { name: "state", description: "Issue state (default: open)", enum: ["open", "closed", "all"], type: "string" },
    ],
    execute: (cred, args) => GithubApi.listIssues(cred, args.owner, args.repo, args.state),
  },
  {
    name: "github_search_code",
    description: "Search for code in GitHub",
    args: [
      { name: "query", description: "Search query (supports GitHub code search syntax)", required: true },
      { name: "sort", description: "Sort by", enum: ["indexed"], type: "string" },
      { name: "order", description: "Order direction", enum: ["asc", "desc"], type: "string" },
    ],
    execute: (cred, args) => GithubApi.searchCode(cred, args.query, args.sort, args.order),
  },
  {
    name: "github_list_repos",
    description: "List repositories for the authenticated user",
    args: [
      {
        name: "type",
        description: "Repository type (default: owner)",
        enum: ["all", "owner", "member"],
        type: "string",
      },
      { name: "sort", description: "Sort by", enum: ["updated", "pushed", "full_name"], type: "string" },
    ],
    execute: (cred, args) => GithubApi.listRepos(cred, args.type, args.sort),
  },
]

const LOVABLE_OPERATIONS: OperationSpec[] = [
  {
    name: "lovable_get_projects",
    description: "Get all Lovable projects",
    args: [],
    execute: (cred) => LovableApi.getProjects(cred),
  },
  {
    name: "lovable_get_project",
    description: "Get information about a Lovable project",
    args: [{ name: "projectId", description: "The Lovable project ID", required: true }],
    execute: (cred, args) => LovableApi.getProject(cred, args.projectId),
  },
  {
    name: "lovable_get_chats",
    description: "Get all chats for a Lovable project",
    args: [{ name: "projectId", description: "The Lovable project ID", required: true }],
    execute: (cred, args) => LovableApi.getChats(cred, args.projectId),
  },
  {
    name: "lovable_send_message",
    description: "Send a message to a Lovable project",
    args: [
      { name: "projectId", description: "The Lovable project ID", required: true },
      { name: "message", description: "The message to send", required: true },
      { name: "chatId", description: "Existing chat ID (optional, creates new chat if not provided)", type: "string" },
    ],
    execute: (cred, args) => LovableApi.sendMessage(cred, args.projectId, args.message, args.chatId),
  },
  {
    name: "lovable_get_project_files",
    description: "Get all files in a Lovable project",
    args: [{ name: "projectId", description: "The Lovable project ID", required: true }],
    execute: (cred, args) => LovableApi.getProjectFiles(cred, args.projectId),
  },
  {
    name: "lovable_run_prompt",
    description: "Run a prompt in a Lovable project",
    args: [
      { name: "projectId", description: "The Lovable project ID", required: true },
      { name: "prompt", description: "The prompt to run", required: true },
    ],
    execute: (cred, args) => LovableApi.runPrompt(cred, args.projectId, args.prompt),
  },
]

const CONNECTOR_SPECS: Record<string, ConnectorSpec> = {
  figma: {
    type: "figma",
    credentialType: "token",
    operations: FIGMA_OPERATIONS,
    healthCheck: (cred) => FigmaApi.getMe(cred),
  },
  slack: {
    type: "slack",
    credentialType: "botToken",
    operations: SLACK_OPERATIONS,
    healthCheck: (cred) => SlackApi.listUsers(cred),
  },
  github: {
    type: "github",
    credentialType: "token",
    operations: GITHUB_OPERATIONS,
    healthCheck: (cred) => GithubApi.getUser(cred),
  },
  lovable: {
    type: "lovable",
    credentialType: "token",
    operations: LOVABLE_OPERATIONS,
    healthCheck: (cred) => LovableApi.getProjects(cred),
  },
}

export function getConnectorSpec(type: string): ConnectorSpec | undefined {
  return CONNECTOR_SPECS[type]
}

export function listConnectorTypes(): string[] {
  return Object.keys(CONNECTOR_SPECS)
}

export async function createTools(name: string, connector: Config.Connector): Promise<Record<string, Tool>> {
  const spec = CONNECTOR_SPECS[connector.type]
  if (!spec) return {}

  const credential = await resolveCredential(name, connector)
  if (!credential) return {}

  const tools: Record<string, Tool> = {}

  for (const operation of spec.operations) {
    const toolName = `${name}_${operation.name}`
    tools[toolName] = dynamicTool({
      description: operation.description,
      inputSchema: jsonSchema({
        type: "object",
        properties: Object.fromEntries(
          operation.args.map((arg) => [
            arg.name,
            {
              type: arg.type ?? "string",
              description: arg.description,
              ...(arg.enum && { enum: arg.enum }),
            },
          ]),
        ),
        required: operation.args.filter((arg) => arg.required).map((arg) => arg.name),
        additionalProperties: false,
      }),
      execute: async (args: unknown) => {
        const typedArgs = args as Record<string, any>
        const result = await operation.execute(credential, typedArgs)
        return typeof result === "string" ? result : JSON.stringify(result, null, 2)
      },
    }) as Tool
  }

  return tools
}

export async function executeOperation(
  name: string,
  connector: Config.Connector,
  operationName: string,
  args: Record<string, any>,
): Promise<any> {
  const spec = CONNECTOR_SPECS[connector.type]
  if (!spec) throw new Error(`Unknown connector type: ${connector.type}`)

  const credential = await resolveCredential(name, connector)
  if (!credential) throw new Error(`No credential for connector "${name}"`)

  const operation = spec.operations.find((op) => op.name === operationName)
  if (!operation) throw new Error(`Unknown operation: ${operationName}`)

  return operation.execute(credential, args)
}

export function getHealthCheck(type: string): ((credential: string) => Promise<void>) | undefined {
  return CONNECTOR_SPECS[type]?.healthCheck
}

export function getOperationSpec(type: string, operationName: string): OperationSpec | undefined {
  return CONNECTOR_SPECS[type]?.operations.find((op) => op.name === operationName)
}

export function getPrompts(type: string): Array<{ name: string; description: string; args: OperationArg[] }> {
  const spec = CONNECTOR_SPECS[type]
  if (!spec) return []

  return spec.operations.map((op) => ({
    name: op.name,
    description: op.description,
    args: op.args,
  }))
}
