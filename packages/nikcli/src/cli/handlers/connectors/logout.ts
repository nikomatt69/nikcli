import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["connectors"].commands["logout"], async (input) => {
  const { ConnectorsLogoutCommand } = await import("@/cli/cmd/connectors")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
  }
  await ConnectorsLogoutCommand.handler(args)
})
