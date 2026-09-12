import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["companion"].commands["open"], async (input) => {
  const { CompanionOpenCommand } = await import("@/cli/cmd/companion")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "port": input["port"],
    "session": Option.getOrUndefined(input["session"]),
  }
  await CompanionOpenCommand.handler(args)
})
