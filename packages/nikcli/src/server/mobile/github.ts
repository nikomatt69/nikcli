import { Effect } from "effect"
import { Config } from "@/config/config"
import { ConnectorAuth } from "@/connectors/auth"
import { Connectors } from "@/connectors"
import { GithubApi } from "@/connectors/api/github"
import { withInstanceAsync } from "@/effect"
import { MobileGithubRepo } from "@/mobile/github-repo"
import { Session } from "@/session"
import { Worktree } from "@/worktree"
import { Workspace } from "@/workspace"
import { WorkspaceContext } from "@/workspace/workspace-context"
import {
  GithubAuthInput,
  GithubOAuthClientInput,
  MobileGithubDeviceAuthPollInput,
  MobileGithubSessionCreateInput,
  configGet,
  createExecutionWorkspace,
  ensureGlobalGithubConnector,
  githubConnectorEntry,
  githubImports,
  githubToken,
  pollGithubDeviceAuth,
  runConnectorAuth,
  runSession,
  runWorktreeForDirectory,
  sessionSeed,
  slug,
  startGithubDeviceAuth,
  storeGithubToken,
} from "./helpers"
import { body, isResponse, json } from "./request"

export async function handleGithubRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (!path.startsWith("/mobile/github/")) return
  if (path === "/mobile/github/repos" && request.method === "GET") {
    const token = await githubToken()
    if (!token) return json({ error: "GitHub token not configured" }, 401)
    const [repos, imports] = await Promise.all([GithubApi.listRepos(token, "all", "updated"), githubImports()])
    return json(
      (repos as Array<{ full_name: string }>).map((repo) => {
        const existing = imports.get(repo.full_name.toLowerCase())
        return {
          ...repo,
          imported: Boolean(existing),
          imported_directory: existing?.directory,
          imported_project_id: existing?.projectID,
        }
      }),
    )
  }
  const branches = path.match(/^\/mobile\/github\/repos\/([^/]+)\/([^/]+)\/branches$/)
  if (branches && request.method === "GET") {
    const token = await githubToken()
    if (!token) return json({ error: "GitHub token not configured" }, 401)
    return json(await GithubApi.listBranches(token, decodeURIComponent(branches[1]), decodeURIComponent(branches[2])))
  }
  if (path === "/mobile/github/imports" && request.method === "GET") return json(await MobileGithubRepo.list())
  if (path === "/mobile/github/oauth/client" && request.method === "POST") {
    const input = await body(request, GithubOAuthClientInput)
    if (isResponse(input)) return input
    const { key } = await ensureGlobalGithubConnector({
      oauthClientId: input.clientId.trim(),
      clientId: input.clientId.trim(),
    })
    Connectors.invalidateConnector(key)
    Connectors.invalidateConnector("github")
    return json(await configGet())
  }
  if (path === "/mobile/github/oauth/device" && request.method === "POST") {
    try {
      return json(await startGithubDeviceAuth())
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  }
  if (path === "/mobile/github/oauth/device/poll" && request.method === "POST") {
    const input = await body(request, MobileGithubDeviceAuthPollInput)
    if (isResponse(input)) return input
    try {
      return json(await pollGithubDeviceAuth(input.deviceCode))
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  }
  if (path === "/mobile/github/auth" && request.method === "POST") {
    const input = await body(request, GithubAuthInput)
    if (isResponse(input)) return input
    await storeGithubToken(input.token)
    return json({ success: true })
  }
  if (path === "/mobile/github/auth" && request.method === "DELETE") {
    const config = await configGet().catch(() => undefined),
      { key } = githubConnectorEntry(config)
    await runConnectorAuth(
      Effect.gen(function* () {
        const auth = yield* ConnectorAuth.Service
        yield* auth.remove(key)
        if (key !== "github") yield* auth.remove("github")
      }),
    )
    Connectors.invalidateConnector(key)
    Connectors.invalidateConnector("github")
    return json({ success: true })
  }
  if (path === "/mobile/github/import" && request.method === "POST") {
    const input = await body(request, MobileGithubRepo.ImportRequest)
    if (isResponse(input)) return input
    const token = await githubToken()
    if (!token) return json({ error: "GitHub token not configured" }, 401)
    return json(await MobileGithubRepo.importRepo(input, token))
  }
  if (path === "/mobile/github/session" && request.method === "POST") {
    const input = await body(request, MobileGithubSessionCreateInput)
    if (isResponse(input)) return input
    const token = await githubToken()
    if (!token) return json({ error: "GitHub token not configured" }, 401)
    const baseBranch = input.baseBranch.trim() || input.defaultBranch
    const imported = await MobileGithubRepo.importRepo(
      {
        owner: input.owner,
        repo: input.repo,
        cloneUrl: input.cloneUrl,
        defaultBranch: input.defaultBranch,
        private: input.private,
      },
      token,
    )
    const seed = sessionSeed(),
      headBranch = `nikcli/mobile/${slug(input.repo)}/${seed}`
    const worktree = await runWorktreeForDirectory(
      imported.import.directory,
      Effect.gen(function* () {
        return yield* (yield* Worktree.Service).create({
          name: `${slug(input.repo)}-${slug(baseBranch)}-${seed}`,
          branch: headBranch,
          baseBranch,
          remote: "origin",
        })
      }),
    )
    if (!worktree.branch) throw new Error("GitHub mobile worktree must have a branch")
    let workspace: Workspace.Info | undefined
    try {
      workspace = await createExecutionWorkspace({
        directory: worktree.directory,
        branch: headBranch,
        target: input.executionTarget,
      })
      const session = await withInstanceAsync({ directory: worktree.directory }, () =>
        WorkspaceContext.provide({
          workspaceID: workspace?.id,
          fn: () =>
            runSession(
              Effect.gen(function* () {
                return yield* (yield* Session.Service).create({
                  title: input.title?.trim() || `${input.owner}/${input.repo} ${baseBranch}`,
                  workspaceID: workspace?.id,
                  github: {
                    owner: input.owner,
                    repo: input.repo,
                    fullName: `${input.owner}/${input.repo}`,
                    baseBranch,
                    headBranch,
                    repositoryDirectory: imported.import.directory,
                    cloneUrl: imported.import.cloneUrl,
                    htmlUrl: input.htmlUrl,
                    private: input.private,
                    worktree: { ...worktree, branch: worktree.branch! },
                  },
                })
              }),
            ),
        }),
      )
      return json({ session, worktree, project: imported.project, workspace })
    } catch (error) {
      if (workspace) await Workspace.remove(workspace.id).catch(() => undefined)
      await runWorktreeForDirectory(
        imported.import.directory,
        Effect.gen(function* () {
          yield* (yield* Worktree.Service).remove({ directory: worktree.directory })
        }),
      ).catch(() => undefined)
      throw error
    }
  }
}
