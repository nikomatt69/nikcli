import type { Plugin, PluginInput } from "@nikcli-ai/plugin"
import { tool } from "@nikcli-ai/plugin"

const GITHUB_API = "https://api.github.com"

let cachedToken: string | null = null

async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken

  const envToken = process.env.GITHUB_TOKEN
  if (envToken) {
    cachedToken = envToken
    return envToken
  }

  return null
}

async function githubFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  const token = await getToken()
  if (!token) throw new Error("GITHUB_TOKEN not configured")

  const response = await fetch(`${GITHUB_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`GitHub API error: ${response.status} - ${error}`)
  }

  return response.json()
}

function parseRepo(repoStr: string): { owner: string; repo: string } {
  const parts = repoStr.split("/")
  if (parts.length !== 2) throw new Error("Invalid repo format. Use owner/repo")
  return { owner: parts[0], repo: parts[1] }
}

export const GithubAdvancedPlugin: Plugin = async (_input: PluginInput) => {
  return {
    tool: {
      github_list_issues: tool({
        description: "List issues in a repository with optional filters",
        args: {
          repo: tool.schema.string().describe("Repository in format owner/repo"),
          state: tool.schema.enum(["open", "closed", "all"]).optional().describe("Issue state (default: open)"),
          labels: tool.schema.string().optional().describe("Comma-separated labels to filter"),
          assignee: tool.schema.string().optional().describe("Assignee username"),
          milestone: tool.schema.string().optional().describe("Milestone number or title"),
          limit: tool.schema.number().optional().describe("Max issues to return (default 30)"),
        },
        async execute(args, _ctx) {
          try {
            const { owner, repo } = parseRepo(args.repo)
            const params = new URLSearchParams()
            params.set("state", args.state ?? "open")
            if (args.labels) params.set("labels", args.labels)
            if (args.assignee) params.set("assignee", args.assignee)
            if (args.milestone) params.set("milestone", args.milestone)
            params.set("per_page", String(args.limit ?? 30))

            const issues = await githubFetch(`/repos/${owner}/${repo}/issues?${params}`)

            if (!issues.length) return "No issues found"

            const formatted = issues
              .map((issue: any) => {
                const labels = issue.labels?.map((l: any) => l.name).join(", ") || ""
                const assignee = issue.assignee?.login || "unassigned"
                return `#${issue.number}: ${issue.title}
  State: ${issue.state} | Assignee: ${assignee}
  Labels: ${labels || "none"}
  URL: ${issue.html_url}`
              })
              .join("\n\n")

            return `Issues in ${args.repo}:\n\n${formatted}`
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      github_create_issue: tool({
        description: "Create a new issue in a repository",
        args: {
          repo: tool.schema.string().describe("Repository in format owner/repo"),
          title: tool.schema.string().describe("Issue title"),
          body: tool.schema.string().optional().describe("Issue body/description"),
          labels: tool.schema.string().optional().describe("Comma-separated labels"),
          assignee: tool.schema.string().optional().describe("Assignee username"),
        },
        async execute(args, _ctx) {
          try {
            const { owner, repo } = parseRepo(args.repo)
            const payload: any = { title: args.title }
            if (args.body) payload.body = args.body
            if (args.labels) payload.labels = args.labels.split(",").map((l) => l.trim())
            if (args.assignee) payload.assignee = args.assignee

            const issue = await githubFetch(`/repos/${owner}/${repo}/issues`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })

            return `Issue created successfully!\n#${issue.number}: ${issue.title}\nURL: ${issue.html_url}`
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      github_manage_labels: tool({
        description: "Add or remove labels from an issue",
        args: {
          repo: tool.schema.string().describe("Repository in format owner/repo"),
          issueNumber: tool.schema.number().describe("Issue number"),
          action: tool.schema.enum(["add", "remove"]).describe("Action to perform"),
          labels: tool.schema.string().describe("Comma-separated labels"),
        },
        async execute(args, _ctx) {
          try {
            const { owner, repo } = parseRepo(args.repo)
            const labelList = args.labels.split(",").map((l) => l.trim())

            if (args.action === "add") {
              const issue = await githubFetch(`/repos/${owner}/${repo}/issues/${args.issueNumber}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ labels: labelList }),
              })
              return `Labels added to issue #${args.issueNumber}: ${args.labels}`
            } else {
              const currentLabels = await githubFetch(`/repos/${owner}/${repo}/issues/${args.issueNumber}`)
              const remaining = currentLabels.labels
                .filter((l: any) => !labelList.includes(l.name))
                .map((l: any) => l.name)

              await githubFetch(`/repos/${owner}/${repo}/issues/${args.issueNumber}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ labels: remaining }),
              })

              return `Labels removed from issue #${args.issueNumber}: ${args.labels}`
            }
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      github_list_prs: tool({
        description: "List pull requests in a repository",
        args: {
          repo: tool.schema.string().describe("Repository in format owner/repo"),
          state: tool.schema.enum(["open", "closed", "all"]).optional().describe("PR state (default: open)"),
          limit: tool.schema.number().optional().describe("Max PRs to return (default 30)"),
        },
        async execute(args, _ctx) {
          try {
            const { owner, repo } = parseRepo(args.repo)
            const params = new URLSearchParams()
            params.set("state", args.state ?? "open")
            params.set("per_page", String(args.limit ?? 30))

            const prs = await githubFetch(`/repos/${owner}/${repo}/pulls?${params}`)

            if (!prs.length) return "No pull requests found"

            const formatted = prs
              .map((pr: any) => {
                return `#${pr.number}: ${pr.title}
  State: ${pr.state} | Draft: ${pr.draft}
  Author: ${pr.user.login}
  Base: ${pr.base.ref} <- Head: ${pr.head.ref}
  URL: ${pr.html_url}`
              })
              .join("\n\n")

            return `Pull Requests in ${args.repo}:\n\n${formatted}`
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      github_review_pr: tool({
        description: "Add a review comment to a pull request",
        args: {
          repo: tool.schema.string().describe("Repository in format owner/repo"),
          prNumber: tool.schema.number().describe("Pull request number"),
          body: tool.schema.string().describe("Review comment"),
          event: tool.schema
            .enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"])
            .optional()
            .describe("Review event (default: COMMENT)"),
        },
        async execute(args, _ctx) {
          try {
            const { owner, repo } = parseRepo(args.repo)

            const review = await githubFetch(`/repos/${owner}/${repo}/pulls/${args.prNumber}/reviews`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                body: args.body,
                event: args.event ?? "COMMENT",
              }),
            })

            return `Review added to PR #${args.prNumber}\nState: ${review.state}`
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      github_trigger_workflow: tool({
        description: "Trigger a workflow dispatch event",
        args: {
          repo: tool.schema.string().describe("Repository in format owner/repo"),
          workflowId: tool.schema.string().describe("Workflow file name or ID"),
          ref: tool.schema.string().optional().describe("Git ref (branch/tag), default: main"),
          inputs: tool.schema.string().optional().describe("JSON workflow inputs"),
        },
        async execute(args, _ctx) {
          try {
            const { owner, repo } = parseRepo(args.repo)
            const ref = args.ref ?? "main"
            const body: any = { ref }
            if (args.inputs) {
              try {
                body.inputs = JSON.parse(args.inputs)
              } catch {
                return "Error: Invalid JSON in inputs"
              }
            }

            await githubFetch(`/repos/${owner}/${repo}/actions/workflows/${args.workflowId}/dispatches`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })

            return `Workflow ${args.workflowId} triggered on ${ref}`
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      github_get_workflow_status: tool({
        description: "Get workflow run status",
        args: {
          repo: tool.schema.string().describe("Repository in format owner/repo"),
          workflowId: tool.schema
            .string()
            .optional()
            .describe("Workflow file name or ID (optional, lists all if omitted)"),
          limit: tool.schema.number().optional().describe("Max runs to return (default 10)"),
        },
        async execute(args, _ctx) {
          try {
            const { owner, repo } = parseRepo(args.repo)

            if (args.workflowId) {
              const params = new URLSearchParams()
              params.set("per_page", String(args.limit ?? 10))
              const runs = await githubFetch(
                `/repos/${owner}/${repo}/actions/workflows/${args.workflowId}/runs?${params}`,
              )

              if (!runs.workflow_runs.length) return "No workflow runs found"

              const formatted = runs.workflow_runs
                .map((run: any) => {
                  return `- ${run.name} #${run.run_number}
  Status: ${run.status} | Conclusion: ${run.conclusion || "pending"}
  Branch: ${run.head_branch}
  Triggered: ${new Date(run.created_at).toLocaleString()}
  URL: ${run.html_url}`
                })
                .join("\n\n")

              return `Workflow runs for ${args.workflowId}:\n\n${formatted}`
            } else {
              const params = new URLSearchParams()
              params.set("per_page", String(args.limit ?? 10))
              const workflows = await githubFetch(`/repos/${owner}/${repo}/actions/runs?${params}`)

              if (!workflows.workflow_runs.length) return "No workflow runs found"

              const formatted = workflows.workflow_runs
                .map((run: any) => {
                  return `- ${run.name} #${run.run_number}
  Status: ${run.status} | Conclusion: ${run.conclusion || "pending"}
  Branch: ${run.head_branch}`
                })
                .join("\n\n")

              return `Recent workflow runs:\n\n${formatted}`
            }
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      github_search_code: tool({
        description: "Search for code across repositories",
        args: {
          query: tool.schema.string().describe("Search query (GitHub search syntax)"),
          repo: tool.schema.string().optional().describe("Limit search to specific repo (owner/repo)"),
          language: tool.schema.string().optional().describe("Programming language filter"),
          limit: tool.schema.number().optional().describe("Max results (default 30)"),
        },
        async execute(args, _ctx) {
          try {
            const params = new URLSearchParams()
            params.set("q", args.query)
            if (args.repo) params.set("q", `${args.query} repo:${args.repo}`)
            if (args.language) params.set("q", `${params.get("q")} language:${args.language}`)
            params.set("per_page", String(args.limit ?? 30))

            const results = await githubFetch(`/search/code?${params}`)

            if (!results.items.length) return "No code found"

            const formatted = results.items
              .slice(0, 20)
              .map((item: any) => {
                return `${item.path}
  Repo: ${item.repository.full_name}
  URL: ${item.html_url}`
              })
              .join("\n\n")

            const more = results.total_count > 20 ? `\n... and ${results.total_count - 20} more` : ""
            return `Found ${results.total_count} results:\n\n${formatted}${more}`
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),
    },
  }
}

export default GithubAdvancedPlugin
