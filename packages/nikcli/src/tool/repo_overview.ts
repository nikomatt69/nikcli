import path from "path"
import z from "zod"
import { Global } from "@/global"
import { assertExternalDirectory } from "./external-directory"
import { Tool } from "./tool"
import DESCRIPTION from "./repo_overview.txt"
import { cloneOrUpdateRepository, repositoryOverview } from "@/util/repository"

const parameters = z.object({
  repository: z
    .string()
    .optional()
    .describe("Repository to clone or refresh before producing the overview. Accepts the same formats as repo_clone."),
  branch: z.string().optional().describe("Branch, tag, or ref to checkout when repository is provided"),
  directory: z.string().optional().describe("Absolute path to an existing managed clone directory"),
})

export const RepoOverviewTool = Tool.define("repo_overview", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    if (!params.repository && !params.directory) {
      throw new Error("repo_overview requires either repository or directory")
    }

    let directory = params.directory
    if (params.repository) {
      await ctx.ask({
        permission: "repo_clone",
        patterns: [params.repository],
        always: ["*"],
        metadata: {
          repository: params.repository,
          branch: params.branch,
        },
      })
      const clone = await cloneOrUpdateRepository({
        repository: params.repository,
        branch: params.branch,
        signal: ctx.abort,
      })
      directory = clone.directory
    }
    if (!directory) throw new Error("Unable to resolve repository directory")
    if (!path.isAbsolute(directory)) throw new Error("directory must be an absolute path")

    await assertExternalDirectory(ctx, directory, { kind: "directory" })
    await ctx.ask({
      permission: "repo_overview",
      patterns: [directory],
      always: [path.join(Global.Path.repos, "*")],
      metadata: {
        directory,
        repository: params.repository,
      },
    })

    const overview = await repositoryOverview(directory, { signal: ctx.abort })
    const topLevel = overview.topLevel.map((item) => `- ${item.name}: ${item.count}`).join("\n")
    const sampleFiles = overview.sampleFiles.map((file) => `- ${file}`).join("\n")
    const output = [
      `Directory: ${overview.directory}`,
      overview.remote ? `Remote: ${overview.remote}` : undefined,
      overview.branch ? `Branch: ${overview.branch}` : undefined,
      overview.commit ? `Commit: ${overview.commit}` : undefined,
      `Tracked files: ${overview.fileCount}`,
      "",
      "Top-level entries:",
      topLevel || "- none",
      "",
      "Sample files:",
      sampleFiles || "- none",
    ]
      .filter((line) => line !== undefined)
      .join("\n")

    return {
      title: path.basename(directory),
      output,
      metadata: overview,
    }
  },
})
