import { Server } from "../../server/server"
import { Ssh } from "../../server/ssh"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless nikcli server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)

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
      workspaceSync = (await Project.list()).map((project) => Workspace.startSyncing(project))
    }

    const sshServer = Ssh.start()
    if (sshServer) {
      console.log(`nikcli SSH server listening on ssh://${Flag.NIKCLI_SERVER_SSH_HOST}:${Flag.NIKCLI_SERVER_SSH_PORT}`)
    }

    await new Promise(() => {})

    await server.stop()
    await Promise.all(workspaceSync.map((item) => item.stop()))
    if (sshServer) {
      await Ssh.stop()
    }
  },
})
