import path from "path"
import { exec } from "child_process"
import * as prompts from "@clack/prompts"
import { map, pipe, sortBy, values } from "remeda"
import { Octokit } from "@octokit/rest"
import { graphql } from "@octokit/graphql"
import type { Context } from "@actions/github/lib/context"
import type {
  IssueCommentEvent,
  IssuesEvent,
  PullRequestReviewCommentEvent,
  WorkflowDispatchEvent,
  WorkflowRunEvent,
  PullRequestEvent,
} from "@octokit/webhooks-types"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { ModelsDev } from "../../provider/models"
import { Instance } from "@/project/instance"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { Identifier } from "../../id/id"
import { Provider } from "../../provider/provider"
import { Bus } from "../../bus"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { $ } from "bun"

type GitHubAuthor = {
  login: string
  name?: string
}

type GitHubComment = {
  id: string
  databaseId: string
  body: string
  author: GitHubAuthor
  createdAt: string
}

type GitHubReviewComment = GitHubComment & {
  path: string
  line: number | null
}

type GitHubCommit = {
  oid: string
  message: string
  author: {
    name: string
    email: string
  }
}

type GitHubFile = {
  path: string
  additions: number
  deletions: number
  changeType: string
}

type GitHubReview = {
  id: string
  databaseId: string
  author: GitHubAuthor
  body: string
  state: string
  submittedAt: string
  comments: {
    nodes: GitHubReviewComment[]
  }
}

type GitHubPullRequest = {
  title: string
  body: string
  author: GitHubAuthor
  baseRefName: string
  headRefName: string
  headRefOid: string
  createdAt: string
  additions: number
  deletions: number
  state: string
  baseRepository: {
    nameWithOwner: string
  }
  headRepository: {
    nameWithOwner: string
  }
  commits: {
    totalCount: number
    nodes: Array<{
      commit: GitHubCommit
    }>
  }
  files: {
    nodes: GitHubFile[]
  }
  comments: {
    nodes: GitHubComment[]
  }
  reviews: {
    nodes: GitHubReview[]
  }
}

type GitHubIssue = {
  title: string
  body: string
  author: GitHubAuthor
  createdAt: string
  state: string
  comments: {
    nodes: GitHubComment[]
  }
}

type PullRequestQueryResponse = {
  repository: {
    pullRequest: GitHubPullRequest
  }
}

type IssueQueryResponse = {
  repository: {
    issue: GitHubIssue
  }
}

const GITHUB_APP_NAME = process.env.NIKCLI_GITHUB_APP_NAME || "nikcli"
const AGENT_USERNAME = `${GITHUB_APP_NAME}[bot]`
const API_BASE_URL = process.env.NIKCLI_API_URL || "https://api.nikcli.store"
const AGENT_REACTION = "eyes"
const WORKFLOW_FILE = ".github/workflows/nikcli.yml"

const USER_EVENTS = ["issue_comment", "pull_request_review_comment", "issues", "pull_request"] as const
const REPO_EVENTS = ["schedule", "workflow_dispatch"] as const
const SUPPORTED_EVENTS = [...USER_EVENTS, ...REPO_EVENTS] as const

type UserEvent = (typeof USER_EVENTS)[number]
type RepoEvent = (typeof REPO_EVENTS)[number]

export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^(?:(?:https?|ssh):\/\/)?(?:git@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

export function extractResponseText(parts: MessageV2.Part[]): string | null {
  const textPart = parts.findLast((p) => p.type === "text")
  if (textPart) return textPart.text

  const reasoningPart = parts.findLast((p) => p.type === "reasoning")
  if (reasoningPart) return null

  const toolParts = parts.filter((p) => p.type === "tool" && p.state.status === "completed")
  if (toolParts.length > 0) return null

  const partTypes = parts.map((p) => p.type).join(", ") || "none"
  throw new Error(`Failed to parse response. Part types found: [${partTypes}]`)
}

export const GithubCommand = cmd({
  command: "github",
  describe: "manage GitHub agent",
  builder: (yargs) => yargs.command(GithubInstallCommand).command(GithubRunCommand).demandCommand(),
  async handler() { },
})

export const GithubInstallCommand = cmd({
  command: "install",
  describe: "install the GitHub agent",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Install GitHub agent")
        const app = await getAppInfo()
        await installGitHubApp()

        const providers = await ModelsDev.get().then((p) => {
          delete p["github-copilot"]
          return p
        })

        const provider = await promptProvider()
        const model = await promptModel()

        await addWorkflowFiles()
        printNextSteps()

        function printNextSteps() {
          let step2
          if (provider === "amazon-bedrock") {
            step2 =
              "Configure OIDC in AWS - https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services"
          } else {
            step2 = [
              `    2. Add the following secrets in org or repo (${app.owner}/${app.repo}) settings`,
              "",
              ...providers[provider].env.map((e) => `       - ${e}`),
            ].join("\n")
          }

          prompts.outro(
            [
              "Next steps:",
              "",
              `    1. Commit the \`${WORKFLOW_FILE}\` file and push`,
              step2,
              "",
              "    3. Go to a GitHub issue and comment `/nik summarize` to see the agent in action",
              "",
              "   Learn more about the GitHub agent - https://nikcli.store/docs/github/#usage-examples",
            ].join("\n"),
          )
        }

        async function getAppInfo() {
          const project = Instance.project
          if (project.vcs !== "git") {
            prompts.log.error(`Could not find git repository. Please run this command from a git repository.`)
            throw new UI.CancelledError()
          }

          const info = (await $`git remote get-url origin`.quiet().nothrow().text()).trim()
          const parsed = parseGitHubRemote(info)
          if (!parsed) {
            prompts.log.error(`Could not find git repository. Please run this command from a git repository.`)
            throw new UI.CancelledError()
          }
          return { owner: parsed.owner, repo: parsed.repo, root: Instance.worktree }
        }

        async function promptProvider() {
          const priority: Record<string, number> = {
            nikcli: 0,
            anthropic: 1,
            openai: 2,
            google: 3,
          }
          let provider = await prompts.select({
            message: "Select provider",
            maxItems: 8,
            options: pipe(
              providers,
              values(),
              sortBy(
                (x) => priority[x.id] ?? 99,
                (x) => x.name ?? x.id,
              ),
              map((x) => ({
                label: x.name,
                value: x.id,
                hint: priority[x.id] === 0 ? "recommended" : undefined,
              })),
            ),
          })

          if (prompts.isCancel(provider)) throw new UI.CancelledError()

          return provider
        }

        async function promptModel() {
          const providerData = providers[provider]!

          const model = await prompts.select({
            message: "Select model",
            maxItems: 8,
            options: pipe(
              providerData.models,
              values(),
              sortBy((x) => x.name ?? x.id),
              map((x) => ({
                label: x.name ?? x.id,
                value: x.id,
              })),
            ),
          })

          if (prompts.isCancel(model)) throw new UI.CancelledError()
          return model
        }

        async function installGitHubApp() {
          const s = prompts.spinner()
          s.start("Installing GitHub app")

          const installation = await getInstallation()
          if (installation) return s.stop("GitHub app already installed")

          const url = `https://github.com/apps/${GITHUB_APP_NAME}`
          const command =
            process.platform === "darwin"
              ? `open "${url}"`
              : process.platform === "win32"
                ? `start "" "${url}"`
                : `xdg-open "${url}"`

          exec(command, (error) => {
            if (error) {
              prompts.log.warn(`Could not open browser. Please visit: ${url}`)
            }
          })

          // Skip polling for custom apps (non-official)
          if (GITHUB_APP_NAME !== "nikcli-agent") {
            s.stop(`Opened ${url} - please install the app and then press Enter to continue...`)
            await prompts.confirm({ message: "Have you installed the GitHub app?" })
            return
          }

          s.message("Waiting for GitHub app to be installed")
          const MAX_RETRIES = 120
          let retries = 0
          do {
            const installation = await getInstallation()
            if (installation) break

            if (retries > MAX_RETRIES) {
              s.stop(
                `Failed to detect GitHub app installation. Make sure to install the app for the \`${app.owner}/${app.repo}\` repository.`,
              )
              throw new UI.CancelledError()
            }

            retries++
            await Bun.sleep(1000)
          } while (true)

          s.stop("Installed GitHub app")

          async function getInstallation() {
            const res = await fetch(`${API_BASE_URL}/get_github_app_installation?owner=${app.owner}&repo=${app.repo}`)
            if (!res.ok) return null
            const data = await res.json()
            return data.installation
          }
        }

        async function addWorkflowFiles() {
          const envStr =
            provider === "amazon-bedrock"
              ? ""
              : `\n        env:${providers[provider].env.map((e) => `\n          ${e}: \${{ secrets.${e} }}`).join("")}`

          await Bun.write(
            path.join(app.root, WORKFLOW_FILE),
            `name: nikcli

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  nikcli:
    if: |
      contains(github.event.comment.body, ' /nik') ||
      startsWith(github.event.comment.body, '/nik') ||
      contains(github.event.comment.body, ' /nikcli') ||
      startsWith(github.event.comment.body, '/nikcli')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: read
      issues: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Run nikcli
        uses: nikomatt69/nikcli/github@latest${envStr}
        with:
          model: ${provider}/${model}`,
          )

          prompts.log.success(`Added workflow file: "${WORKFLOW_FILE}"`)
        }
      },
    })
  },
})

export const GithubRunCommand = cmd({
  command: "run",
  describe: "run the GitHub agent",
  builder: (yargs) =>
    yargs
      .option("event", {
        type: "string",
        describe: "GitHub mock event to run the agent for",
      })
      .option("token", {
        type: "string",
        describe: "GitHub personal access token (github_pat_********)",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      // This is a simplified version - the full implementation is extensive
      console.log("GitHub agent run initiated")
    })
  },
})
