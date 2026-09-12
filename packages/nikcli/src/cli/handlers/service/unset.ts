import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["unset"], async (input) => {
  const { UnsetCommand } = await import("@/cli/cmd/service")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "key": input["key"],
    "nested": Option.getOrUndefined(input["nested"]),
  }
  await UnsetCommand.handler(args)
})
