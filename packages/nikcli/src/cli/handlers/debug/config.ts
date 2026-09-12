import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["config"], async (input) => {
  const { ConfigCommand } = await import("@/cli/cmd/debug/config")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await ConfigCommand.handler(args)
})
