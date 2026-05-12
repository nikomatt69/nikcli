import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./repo_clone.txt"
import { cloneOrUpdateRepository } from "@/util/repository"

const parameters = z.object({
  repository: z
    .string()
    .describe("GitHub shorthand (owner/repo), GitHub URL, SSH URL, HTTPS Git URL, or local Git repository path"),
  branch: z.string().optional().describe("Branch, tag, or ref to checkout after cloning"),
})

export const RepoCloneTool = Tool.define("repo_clone", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "repo_clone",
      patterns: [params.repository],
      always: ["*"],
      metadata: {
        repository: params.repository,
        branch: params.branch,
      },
    })

    const result = await cloneOrUpdateRepository({
      repository: params.repository,
      branch: params.branch,
      signal: ctx.abort,
    })

    const label =
      result.repository.kind === "github"
        ? `${result.repository.owner}/${result.repository.repo}`
        : result.repository.cloneUrl
    const output = [
      `Repository: ${label}`,
      `Directory: ${result.directory}`,
      `Status: ${result.cloned ? "cloned" : "updated"}`,
      result.branch ? `Ref: ${result.branch}` : undefined,
      result.commit ? `Commit: ${result.commit}` : undefined,
    ]
      .filter(Boolean)
      .join("\n")

    return {
      title: label,
      output,
      metadata: {
        repository: params.repository,
        directory: result.directory,
        cloned: result.cloned,
        branch: result.branch,
        commit: result.commit,
      },
    }
  },
})
