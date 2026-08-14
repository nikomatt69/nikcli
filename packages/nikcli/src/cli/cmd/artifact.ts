import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Artifact } from "../../artifact"
import { UI } from "../ui"
import { Log } from "@nikcli-ai/util/log"

const log = Log.create({ service: "artifact-command" })

export const ArtifactCommand = cmd({
  command: "artifact",
  describe: "manage published artifacts (nikcli.store/artifact)",
  builder: (yargs: Argv) =>
    yargs.command(ArtifactLoginCommand).command(ArtifactLogoutCommand).command(ArtifactListCommand).demandCommand(),
  async handler() {},
})

export const ArtifactLoginCommand = cmd({
  command: "login",
  describe: "verify the active CLI user used for artifact publishing",
  async handler() {
    UI.empty()
    prompts.intro("nikcli.store account")

    const spinner = prompts.spinner()
    spinner.start("Checking the active CLI user...")
    try {
      const { user } = await Artifact.login()
      spinner.stop("Account ready")
      prompts.log.success(`Using ${user.display_name || user.username} (${user.email})`)
      prompts.log.info(`Identity server: ${Artifact.authServerUrl()}`)
      prompts.log.info("The web app, Studio, mobile, and artifact publishing use this same CLI account.")
      prompts.outro("Done")
    } catch (error) {
      spinner.stop("No active CLI user", 1)
      log.error("artifact login failed", { error })
      prompts.log.warn(error instanceof Error ? error.message : "Unknown error")
      prompts.log.info(
        "Publishing still works without a login — artifacts are then reachable only via their ?key= capability link.",
      )
      prompts.outro("Done")
    }
  },
})

export const ArtifactLogoutCommand = cmd({
  command: "logout",
  describe: "explain how artifact authentication follows the CLI account",
  async handler() {
    UI.empty()
    prompts.intro("nikcli.store account")
    await Artifact.logout()
    prompts.log.info(
      "Artifacts have no separate login. Sign out from the CLI/TUI account screen to end the shared session.",
    )
    prompts.outro("Done")
  },
})

export const ArtifactListCommand = cmd({
  command: "list [session-id]",
  aliases: ["ls"],
  describe: "list artifacts published from a session",
  builder: (yargs: Argv) =>
    yargs.positional("session-id", {
      type: "string",
      describe: "Session ID (lists artifacts for this session)",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      UI.empty()
      prompts.intro("Artifacts")

      if (!args.sessionId) {
        prompts.log.error("Pass a session ID: nikcli artifact list <session-id>")
        prompts.outro("Done")
        return
      }

      const artifacts = await Artifact.list(args.sessionId)
      if (artifacts.length === 0) {
        prompts.log.warn("No artifacts published from this session")
        prompts.outro("Done")
        return
      }

      for (const artifact of artifacts) {
        prompts.log.info(`${artifact.title} ${UI.Style.TEXT_DIM}(${artifact.kind}, v${artifact.version})`)
        prompts.log.info(`  ${artifact.url}`)
      }
      prompts.outro(`${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}`)
    })
  },
})
