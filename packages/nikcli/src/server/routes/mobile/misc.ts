import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Installation } from "@/installation"
import { Expo } from "@/mobile/expo"
import { MobileProjectDetect } from "@/mobile/project-detect"
import { Command } from "@/command"
import { getContainerRuntimeInfo } from "@/workspace/adaptors"
import { Effect } from "effect"
import {
  runCommand,
  runProject,
  MobileProject,
  MobileBootstrap,
  MobileCommand,
  currentToken,
  githubToken,
  githubOAuthClientID,
  githubUser,
} from "./helpers"

export const MiscRoutes = () =>
  new Hono()
    .get(
      "/bootstrap",
      describeRoute({
        summary: "Get mobile bootstrap payload",
        description: "Return the current mobile bootstrap state for the connected host.",
        operationId: "mobile.bootstrap",
        responses: {
          200: {
            description: "Bootstrap payload",
            content: { "application/json": { schema: resolver(MobileBootstrap) } },
          },
        },
      }),
      async (c) => {
        const projects = await runProject(
          Effect.gen(function* () {
            const project = yield* Project.Service
            return yield* project.list()
          }),
        )
        const token = currentToken(c)
        const [user, storedGithubToken] = await Promise.all([githubUser(), githubToken()])
        const container = await getContainerRuntimeInfo()
        const oauth = await githubOAuthClientID()
        return c.json({
          version: Installation.VERSION,
          auth: {
            bearerEnabled: true,
            currentToken: token,
          },
          currentProject: {
            ...Instance.project,
            current: true,
          },
          projects: projects.map((project) => ({
            ...project,
            current: project.id === Instance.project.id,
          })),
          execution: {
            container,
          },
          github: {
            connected: Boolean(user),
            tokenAvailable: Boolean(storedGithubToken),
            oauthDeviceEnabled: true,
            oauthDeviceConfigured: Boolean(oauth.clientID),
            oauthClientSource: oauth.source,
            user: user
              ? {
                  login: user.login,
                  name: user.name,
                  avatar_url: user.avatar_url,
                }
              : undefined,
          },
          expo: await Expo.doctor().then((r) => ({
            available: r.expoCli,
            easAvailable: r.easCli,
            details: r.details,
          })),
          mobileProject: await MobileProjectDetect.detect(Instance.directory).then((detected) =>
            detected
              ? {
                  detected: true,
                  platforms: detected.platforms,
                  primaryPlatform: detected.primaryPlatform,
                  method: detected.method,
                  root: detected.root,
                }
              : { detected: false },
          ),
        })
      },
    )
    .get(
      "/command",
      describeRoute({
        summary: "List mobile commands",
        description: "Return command metadata safe for the mobile command palette and slash autocomplete.",
        operationId: "mobile.command.list",
        responses: {
          200: {
            description: "Commands",
            content: { "application/json": { schema: resolver(MobileCommand.array()) } },
          },
        },
      }),
      async (c) => {
        const commands = await runCommand(
          Effect.gen(function* () {
            const command = yield* Command.Service
            return yield* command.list()
          }),
        )
        return c.json(
          commands
            .map((command) => ({
              name: command.name,
              description: command.description,
              agent: command.agent,
              model: command.model,
              mcp: command.mcp,
              skill: command.skill,
              subtask: command.subtask,
              hints: command.hints,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      },
    )
    .get(
      "/project",
      describeRoute({
        summary: "List local projects for mobile",
        description: "Return local projects and sandboxes visible to the connected Nikcli host.",
        operationId: "mobile.project.list",
        responses: {
          200: {
            description: "Projects",
            content: { "application/json": { schema: resolver(MobileProject.array()) } },
          },
        },
      }),
      async (c) => {
        const projects = await runProject(
          Effect.gen(function* () {
            const project = yield* Project.Service
            return yield* project.list()
          }),
        )
        return c.json(
          projects.map((project) => ({
            ...project,
            current: project.id === Instance.project.id,
          })),
        )
      },
    )
