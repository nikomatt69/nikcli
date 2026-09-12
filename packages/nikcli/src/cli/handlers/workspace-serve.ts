import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"
import { resolveNetworkOptions } from "@/cli/network"
import { WorkspaceServer } from "@/workspace/workspace-server/server"

export default Runtime.handler(Commands.commands["workspace-serve"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    port: input["port"],
    hostname: input["hostname"],
    mdns: input["mdns"],
    cors: [...input["cors"]],
  }
  // SAFETY: this command's builder is `withNetworkOptions`, which declares
  // exactly the flags `resolveNetworkOptions` reads. yargs infers a wider
  // argv type than the builder guarantees.
  const opts = await resolveNetworkOptions(args as Parameters<typeof resolveNetworkOptions>[0])
  const server = WorkspaceServer.Listen(opts)
  console.log(`workspace event server listening on http://${server.hostname}:${server.port}/event`)
  await new Promise(() => {})
  await server.stop()
})
