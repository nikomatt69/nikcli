import { Effect } from "effect"
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
import { MobileHttpError } from "./request"

const noToken = () => new MobileHttpError("GitHub token not configured", 401)

/**
 * `GithubApi` rejects with `GithubApiError`, which is not a `MobileHttpError`.
 * The handler wrapper in mobile-handlers.ts only maps `MobileHttpError`; every
 * other rejection becomes `Effect.die`, and the client gets a 500 with an
 * *empty body*. The mobile app then has nothing to render and falls back to
 * "Request to /mobile/github/repos failed with <status>", which says nothing
 * about the actual cause — a stored token GitHub no longer accepts.
 *
 * Translate the upstream failure so the declared error contract carries a
 * message the app can show. A revoked, expired or insufficiently scoped token
 * is by far the common case, and 401 is what moves the user toward
 * reconnecting; anything else keeps GitHub's own wording.
 */
function githubFailure(error: unknown): MobileHttpError {
  if (error instanceof MobileHttpError) return error
  const status =
    typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined
  const message = error instanceof Error && error.message ? error.message : String(error)
  if (status === 401 || status === 403) {
    return new MobileHttpError("GitHub rejected the stored token. Reconnect GitHub to continue.", 401)
  }
  if (status === 404) return new MobileHttpError(message, 404)
  return new MobileHttpError(message, 400)
}

/** Run a GitHub API call, reshaping its rejection into the declared contract. */
async function fromGithub<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw githubFailure(error)
  }
}

export async function githubRepos() {
  const token = await githubToken()
  if (!token) throw noToken()
  const [repos, imports] = await Promise.all([
    fromGithub(() => GithubApi.listRepos(token, "all", "updated")),
    githubImports(),
  ])
  return (
    // SAFETY: `listRepos` returns the GitHub `/user/repos` body, whose every
    // element carries `full_name`; only that field is read here.
    (repos as Array<{ full_name: string }>).map((repo) => {
      const existing = imports.get(repo.full_name.toLowerCase())
      return {
        ...repo,
        imported: Boolean(existing),
        imported_directory: existing?.directory,
        imported_project_id: existing?.projectID,
      }
    })
  )
}

export async function githubBranches(owner: string, repo: string) {
  const token = await githubToken()
  if (!token) throw noToken()
  return fromGithub(() => GithubApi.listBranches(token, owner, repo))
}

export function githubImportsList() {
  return MobileGithubRepo.list()
}

export async function githubOauthClient(input: typeof GithubOAuthClientInput._output) {
  const { key } = await ensureGlobalGithubConnector({
    oauthClientId: input.clientId.trim(),
    clientId: input.clientId.trim(),
  })
  Connectors.invalidateConnector(key)
  Connectors.invalidateConnector("github")
  return configGet()
}

export async function githubOauthDeviceStart() {
  try {
    return await startGithubDeviceAuth()
  } catch (error) {
    throw new MobileHttpError(error instanceof Error ? error.message : String(error), 400)
  }
}

export async function githubOauthDevicePoll(input: typeof MobileGithubDeviceAuthPollInput._output) {
  try {
    return await pollGithubDeviceAuth(input.deviceCode)
  } catch (error) {
    throw new MobileHttpError(error instanceof Error ? error.message : String(error), 400)
  }
}

export async function githubAuthSet(input: typeof GithubAuthInput._output) {
  await storeGithubToken(input.token)
  return { success: true as const }
}

export async function githubAuthRemove() {
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
  return { success: true as const }
}

export async function githubImport(input: typeof MobileGithubRepo.ImportRequest._output) {
  const token = await githubToken()
  if (!token) throw noToken()
  return fromGithub(() => MobileGithubRepo.importRepo(input, token))
}

export async function githubSessionCreate(input: typeof MobileGithubSessionCreateInput._output) {
  const token = await githubToken()
  if (!token) throw noToken()
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
    return { session, worktree, project: imported.project, workspace }
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
