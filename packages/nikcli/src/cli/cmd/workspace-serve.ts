import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { WorkspaceServer } from "../../workspace/workspace-server/server"

export const WorkspaceServeCommand = cmd({
  command: "workspace-serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a remote workspace event server",
  handler: async (args) => {
    // SAFETY: this command's builder is `withNetworkOptions`, which declares
    // exactly the flags `resolveNetworkOptions` reads. yargs infers a wider
    // argv type than the builder guarantees.
    const opts = await resolveNetworkOptions(args as Parameters<typeof resolveNetworkOptions>[0])
    const server = WorkspaceServer.Listen(opts)
    console.log(`workspace event server listening on http://${server.hostname}:${server.port}/event`)
    await new Promise(() => {})
    await server.stop()
  },
})
