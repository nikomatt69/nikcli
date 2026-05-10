import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"
import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"

function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runPromiseWithLayer(Project.defaultLayer, effect)
}

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless nikcli server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args as Parameters<typeof resolveNetworkOptions>[0])

    const loopback = opts.hostname === "127.0.0.1" || opts.hostname === "::1" || opts.hostname === "localhost"
    const tailscaleAuthActive = Flag.NIKCLI_SERVER_TAILSCALE_AUTH && loopback

    if (Flag.NIKCLI_SERVER_TAILSCALE_AUTH && !loopback) {
      console.log(
        "Warning: NIKCLI_SERVER_TAILSCALE_AUTH is set but hostname is not loopback; Tailscale identity headers will not be trusted.",
      )
    }

    if (!Flag.NIKCLI_SERVER_PASSWORD && !tailscaleAuthActive) {
      console.log("Warning: NIKCLI_SERVER_PASSWORD is not set; server is unsecured.")
    }

    const server = Server.listen(opts)
    console.log(`nikcli server listening on http://${server.hostname}:${server.port}`)

    let workspaceSync: Array<ReturnType<typeof Workspace.startSyncing>> = []
    if (Installation.isLocal()) {
      const projects = await runProject(
        Effect.gen(function* () {
          const project = yield* Project.Service
          return yield* project.list()
        }),
      )
      workspaceSync = projects.map((project) => Workspace.startSyncing(project))
    }

    await new Promise(() => {})

    await server.stop()
    await Promise.all(workspaceSync.map((item) => item.stop()))
  },
})
