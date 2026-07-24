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

async function maybeStartRemoteSync(): Promise<{ stop(): Promise<void> } | undefined> {
  const { SyncConfig } = await import("@/sync/sync-config")
  const resolved = await SyncConfig.resolve()
  if (!resolved.url || !resolved.token) return undefined
  // Lazy import to avoid pulling the remote client into the local-only path
  const { SyncCliInit } = await import("@/sync/cli-init")
  return SyncCliInit.startForAllProjects({ url: resolved.url, token: resolved.token })
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
    // Announce the address only once the server has answered a real request, so
    // a broken route table surfaces here instead of on the client's first call.
    try {
      await Server.ready(server)
    } catch (error) {
      await server.stop(true).catch(() => undefined)
      throw error
    }
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

    // Phase 2: optional bidirectional sync to a remote hub
    // (e.g. https://s.nikcli.store). Activated by NIKCLI_REMOTE_URL +
    // NIKCLI_REMOTE_TOKEN or the config file's `sync` block. Zero impact
    // when neither is set.
    const remoteSync = await maybeStartRemoteSync()

    await new Promise(() => {})

    await server.stop()
    if (remoteSync) await remoteSync.stop()
    await Promise.all(workspaceSync.map((item) => item.stop()))
  },
})
