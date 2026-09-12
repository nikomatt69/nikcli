import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["plugin"], async (input) => {
  const { PluginCommand } = await import("@/cli/cmd/plug")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "module": input["module"],
    "global": input["global"],
    "force": input["force"],
  }
  await PluginCommand.handler(args)
})
