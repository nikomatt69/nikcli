import { Effect } from "effect"
import { Command } from "@/command"
import { Installation } from "@/installation"
import { Expo } from "@/mobile/expo"
import { MobileProjectDetect } from "@/mobile/project-detect"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { getContainerRuntimeInfo } from "@/workspace/adaptors"
import { Auth } from "../httpapi/auth"
import { githubOAuthClientID, githubToken, githubUser, runCommand, runProject } from "./helpers"
import { json } from "./request"

async function projects() {
  return runProject(
    Effect.gen(function* () {
      return yield* (yield* Project.Service).list()
    }),
  )
}

export async function handleMiscRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (request.method !== "GET") return
  if (path === "/mobile/bootstrap") {
    const list = await projects()
    const [user, storedGithubToken, container, oauth, expo, detected] = await Promise.all([
      githubUser(),
      githubToken(),
      getContainerRuntimeInfo(),
      githubOAuthClientID(),
      Expo.doctor(),
      MobileProjectDetect.detect(Instance.directory),
    ])
    const principal = Auth.principal(request)
    return json({
      version: Installation.VERSION,
      auth: { bearerEnabled: true, currentToken: principal?.type === "mobile" ? principal.token : undefined },
      currentProject: { ...Instance.project, current: true },
      projects: list.map((project) => ({ ...project, current: project.id === Instance.project.id })),
      execution: { container },
      github: {
        connected: Boolean(user),
        tokenAvailable: Boolean(storedGithubToken),
        reconnectRequired: Boolean(storedGithubToken) && !user,
        oauthDeviceEnabled: true,
        oauthDeviceConfigured: Boolean(oauth.clientID),
        oauthClientSource: oauth.source,
        user: user ? { login: user.login, name: user.name, avatar_url: user.avatar_url } : undefined,
      },
      expo: { available: expo.expoCli, easAvailable: expo.easCli, details: expo.details },
      mobileProject: detected
        ? {
            detected: true,
            platforms: detected.platforms,
            primaryPlatform: detected.primaryPlatform,
            method: detected.method,
            root: detected.root,
          }
        : { detected: false },
    })
  }
  if (path === "/mobile/command") {
    const commands = await runCommand(
      Effect.gen(function* () {
        return yield* (yield* Command.Service).list()
      }),
    )
    return json(
      commands
        .map(({ name, description, agent, model, mcp, skill, subtask, hints }) => ({
          name,
          description,
          agent,
          model,
          mcp,
          skill,
          subtask,
          hints,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
  }
  if (path === "/mobile/project") {
    return json((await projects()).map((project) => ({ ...project, current: project.id === Instance.project.id })))
  }
}
