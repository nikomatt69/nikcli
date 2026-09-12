import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["connectors"].commands["auth"], async (input) => {
  const { ConnectorsAuthCommand } = await import("@/cli/cmd/connectors")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
  }
  await ConnectorsAuthCommand.handler(args)
})
