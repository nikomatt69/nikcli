import { Effect } from "effect"
import { Command } from "@/command"
import { Installation } from "@/installation"
import { MobileAuth } from "@/mobile/auth"
import { Expo } from "@/mobile/expo"
import { MobileProjectDetect } from "@/mobile/project-detect"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { getContainerRuntimeInfo } from "@/workspace/adaptors"
import { githubOAuthClientID, githubToken, githubUser, runCommand, runProject } from "./helpers"

async function projects() {
  return runProject(
    Effect.gen(function* () {
      return yield* (yield* Project.Service).list()
    }),
  )
}

/** The mobile token the request was authenticated with, if any. */
export async function bootstrap(currentToken: MobileAuth.PublicToken | undefined) {
  const list = await projects()
  const [user, storedGithubToken, container, oauth, expo, detected] = await Promise.all([
    githubUser(),
    githubToken(),
    getContainerRuntimeInfo(),
    githubOAuthClientID(),
    Expo.doctor(),
    MobileProjectDetect.detect(Instance.directory),
  ])
  return {
    version: Installation.VERSION,
    auth: { bearerEnabled: true, currentToken },
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
  }
}

export async function commandList() {
  const commands = await runCommand(
    Effect.gen(function* () {
      return yield* (yield* Command.Service).list()
    }),
  )
  return commands
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
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function projectList() {
  return (await projects()).map((project) => ({ ...project, current: project.id === Instance.project.id }))
}
