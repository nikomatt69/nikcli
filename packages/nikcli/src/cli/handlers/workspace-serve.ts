import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["workspace-serve"], async (input) => {
  const { WorkspaceServeCommand } = await import("@/cli/cmd/workspace-serve")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "port": input["port"],
    "hostname": input["hostname"],
    "mdns": input["mdns"],
    "cors": input["cors"],
  }
  await WorkspaceServeCommand.handler(args)
})
