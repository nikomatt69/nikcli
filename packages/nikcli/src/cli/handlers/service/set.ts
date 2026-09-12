import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["set"], async (input) => {
  const { SetCommand } = await import("@/cli/cmd/service")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "key": input["key"],
    "value": input["value"],
    "nested": Option.getOrUndefined(input["nested"]),
  }
  await SetCommand.handler(args)
})
