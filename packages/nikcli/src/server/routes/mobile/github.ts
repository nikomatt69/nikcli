import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { Worktree } from "@/worktree"
import { GithubApi } from "@/connectors/api/github"
import { ConnectorAuth } from "@/connectors/auth"
import { Connectors } from "@/connectors"
import { MobileGithubRepo } from "@/mobile/github-repo"
import { Config } from "@/config/config"
import { Workspace } from "@/workspace"
import { WorkspaceContext } from "@/workspace/workspace-context"
import { errors } from "../../error"
import { Effect } from "effect"
import { withInstanceAsync } from "@/effect"
import {
  runSession,
  runWorktreeForDirectory,
  runConnectorAuth,
  configGet,
  GithubAuthInput,
  GithubOAuthClientInput,
  MobileGithubBranch,
  MobileGithubSessionCreateInput,
  MobileGithubSessionCreateResult,
  MobileGithubDeviceAuthStart,
  MobileGithubDeviceAuthPollInput,
  MobileGithubDeviceAuthPollResult,
  githubConnectorEntry,
  ensureGlobalGithubConnector,
  storeGithubToken,
  githubToken,
  startGithubDeviceAuth,
  pollGithubDeviceAuth,
  githubImports,
  slug,
  sessionSeed,
  createExecutionWorkspace,
} from "./helpers"

export const GithubRoutes = () =>
  new Hono()
    .get(
      "/github/repos",
      describeRoute({
        summary: "List GitHub repositories for mobile",
        description: "List repositories available to the stored GitHub connector token.",
        operationId: "mobile.github.repos",
        responses: {
          200: {
            description: "GitHub repositories",
            content: { "application/json": { schema: resolver(z.array(z.any())) } },
          },
          ...errors(401),
        },
      }),
      async (c) => {
        const token = (await githubToken()) ?? undefined
        if (!token) return c.json({ error: "GitHub token not configured" }, 401)
        const [repos, imports] = await Promise.all([GithubApi.listRepos(token, "all", "updated"), githubImports()])
        return c.json(
          repos.map((repo: any) => {
            const existing = imports.get(String(repo.full_name).toLowerCase())
            return {
              ...repo,
              imported: Boolean(existing),
              imported_directory: existing?.directory,
              imported_project_id: existing?.projectID,
            }
          }),
        )
      },
    )
    .get(
      "/github/repos/:owner/:repo/branches",
      describeRoute({
        summary: "List GitHub branches for mobile",
        description: "List branches for a GitHub repository available to the stored mobile GitHub token.",
        operationId: "mobile.github.branches",
        responses: {
          200: {
            description: "GitHub branches",
            content: { "application/json": { schema: resolver(MobileGithubBranch.array()) } },
          },
          ...errors(401),
        },
      }),
      validator("param", z.object({ owner: z.string(), repo: z.string() })),
      async (c) => {
        const token = (await githubToken()) ?? undefined
        if (!token) return c.json({ error: "GitHub token not configured" }, 401)
        const params = c.req.valid("param")
        const branches = await GithubApi.listBranches(token, params.owner, params.repo)
        return c.json(branches)
      },
    )
    .get(
      "/github/imports",
      describeRoute({
        summary: "List imported GitHub repos for mobile",
        description: "List GitHub repositories that have already been cloned into the Nikcli host cache.",
        operationId: "mobile.github.imports",
        responses: {
          200: {
            description: "Imported repos",
            content: { "application/json": { schema: resolver(MobileGithubRepo.Import.array()) } },
          },
        },
      }),
      async (c) => {
        return c.json(await MobileGithubRepo.list())
      },
    )
    .post(
      "/github/oauth/client",
      describeRoute({
        summary: "Persist GitHub OAuth client ID for mobile",
        description:
          "Save the GitHub OAuth client ID in the global host config so device sign-in remains available across projects and app restarts.",
        operationId: "mobile.github.oauth.clientId.set",
        responses: {
          200: {
            description: "Updated host configuration",
            content: { "application/json": { schema: resolver(Config.Info) } },
          },
          ...errors(400),
        },
      }),
      validator("json", GithubOAuthClientInput),
      async (c) => {
        const { clientId } = c.req.valid("json")
        const { key } = await ensureGlobalGithubConnector({ oauthClientId: clientId.trim(), clientId: clientId.trim() })
        Connectors.invalidateConnector(key)
        Connectors.invalidateConnector("github")
        return c.json(await configGet())
      },
    )
    .post(
      "/github/oauth/device",
      describeRoute({
        summary: "Start GitHub OAuth device flow",
        description: "Start a GitHub device authorization flow and return the verification code for mobile sign-in.",
        operationId: "mobile.github.oauth.device.start",
        responses: {
          200: {
            description: "GitHub device flow started",
            content: { "application/json": { schema: resolver(MobileGithubDeviceAuthStart) } },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        try {
          return c.json(await startGithubDeviceAuth())
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
        }
      },
    )
    .post(
      "/github/oauth/device/poll",
      describeRoute({
        summary: "Poll GitHub OAuth device flow",
        description: "Poll GitHub device authorization status and persist the approved token on the host.",
        operationId: "mobile.github.oauth.device.poll",
        responses: {
          200: {
            description: "GitHub device flow status",
            content: { "application/json": { schema: resolver(MobileGithubDeviceAuthPollResult) } },
          },
          ...errors(400),
        },
      }),
      validator("json", MobileGithubDeviceAuthPollInput),
      async (c) => {
        try {
          return c.json(await pollGithubDeviceAuth(c.req.valid("json").deviceCode))
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
        }
      },
    )
    .post(
      "/github/auth",
      describeRoute({
        summary: "Store GitHub token for mobile",
        description: "Persist a GitHub token on the Nikcli host for mobile repo access.",
        operationId: "mobile.github.auth.set",
        responses: {
          200: {
            description: "GitHub auth status",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(400),
        },
      }),
      validator("json", GithubAuthInput),
      async (c) => {
        const payload = c.req.valid("json")
        await storeGithubToken(payload.token)
        return c.json({ success: true as const })
      },
    )
    .delete(
      "/github/auth",
      describeRoute({
        summary: "Remove stored GitHub token for mobile",
        description: "Delete the mobile GitHub token from the Nikcli host.",
        operationId: "mobile.github.auth.remove",
        responses: {
          200: {
            description: "GitHub auth removed",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      async (c) => {
        const config = await configGet().catch(() => undefined)
        const { key } = githubConnectorEntry(config)
        await runConnectorAuth(
          Effect.gen(function* () {
            const auth = yield* ConnectorAuth.Service
            yield* auth.remove(key)
            if (key !== "github") yield* auth.remove("github")
          }),
        )
        Connectors.invalidateConnector(key)
        Connectors.invalidateConnector("github")
        return c.json({ success: true as const })
      },
    )
    .post(
      "/github/import",
      describeRoute({
        summary: "Import GitHub repo into Nikcli host",
        description: "Clone or refresh a repository from the connected GitHub account into the managed host cache.",
        operationId: "mobile.github.import",
        responses: {
          200: {
            description: "Imported repository",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    import: MobileGithubRepo.Import,
                    project: Project.Info,
                  }),
                ),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      validator("json", MobileGithubRepo.ImportRequest),
      async (c) => {
        const token = (await githubToken()) ?? undefined
        if (!token) return c.json({ error: "GitHub token not configured" }, 401)
        const result = await MobileGithubRepo.importRepo(c.req.valid("json"), token)
        return c.json(result)
      },
    )
    .post(
      "/github/session",
      describeRoute({
        summary: "Create GitHub-backed mobile session",
        description:
          "Import a GitHub repo if needed, create an isolated worktree from a base branch, and start a session there.",
        operationId: "mobile.github.session.create",
        responses: {
          200: {
            description: "GitHub mobile session",
            content: { "application/json": { schema: resolver(MobileGithubSessionCreateResult) } },
          },
          ...errors(400, 401),
        },
      }),
      validator("json", MobileGithubSessionCreateInput),
      async (c) => {
        const token = (await githubToken()) ?? undefined
        if (!token) return c.json({ error: "GitHub token not configured" }, 401)

        const body = c.req.valid("json")
        const baseBranch = body.baseBranch.trim() || body.defaultBranch
        const imported = await MobileGithubRepo.importRepo(
          {
            owner: body.owner,
            repo: body.repo,
            cloneUrl: body.cloneUrl,
            defaultBranch: body.defaultBranch,
            private: body.private,
          },
          token,
        )

        const seed = sessionSeed()
        const headBranch = `nikcli/mobile/${slug(body.repo)}/${seed}`
        let workspace: Workspace.Info | undefined
        const worktree = await runWorktreeForDirectory(
          imported.import.directory,
          Effect.gen(function* () {
            const service = yield* Worktree.Service
            return yield* service.create({
              name: `${slug(body.repo)}-${slug(baseBranch)}-${seed}`,
              branch: headBranch,
              baseBranch,
              remote: "origin",
            })
          }),
        )
        if (!worktree.branch) throw new Error("GitHub mobile worktree must have a branch")
        const githubWorktree = { ...worktree, branch: worktree.branch }

        try {
          workspace = await createExecutionWorkspace({
            directory: worktree.directory,
            branch: headBranch,
            target: body.executionTarget,
          })

          const session = await withInstanceAsync({ directory: worktree.directory }, async () => {
            return WorkspaceContext.provide({
              workspaceID: workspace?.id,
              async fn() {
                return runSession(
                  Effect.gen(function* () {
                    const service = yield* Session.Service
                    return yield* service.create({
                      title: body.title?.trim() || `${body.owner}/${body.repo} ${baseBranch}`,
                      workspaceID: workspace?.id,
                      github: {
                        owner: body.owner,
                        repo: body.repo,
                        fullName: `${body.owner}/${body.repo}`,
                        baseBranch,
                        headBranch,
                        repositoryDirectory: imported.import.directory,
                        cloneUrl: imported.import.cloneUrl,
                        htmlUrl: body.htmlUrl,
                        private: body.private,
                        worktree: githubWorktree,
                      },
                    })
                  }),
                )
              },
            })
          })

          return c.json({ session, worktree, project: imported.project, workspace })
        } catch (error) {
          if (workspace) {
            await Workspace.remove(workspace.id).catch(() => undefined)
          }
          await runWorktreeForDirectory(
            imported.import.directory,
            Effect.gen(function* () {
              const service = yield* Worktree.Service
              yield* service.remove({ directory: worktree.directory })
            }),
          ).catch(() => undefined)
          throw error
        }
      },
    )
