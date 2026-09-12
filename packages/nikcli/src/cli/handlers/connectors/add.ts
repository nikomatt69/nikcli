import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["connectors"].commands["add"], async (input) => {
  const { ConnectorsAddCommand } = await import("@/cli/cmd/connectors")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await ConnectorsAddCommand.handler(args)
})
