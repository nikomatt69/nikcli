import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["get"], async (input) => {
  const { GetCommand } = await import("@/cli/cmd/service")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "key": Option.getOrUndefined(input["key"]),
  }
  await GetCommand.handler(args)
})
