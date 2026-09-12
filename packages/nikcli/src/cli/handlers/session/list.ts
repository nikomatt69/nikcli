import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["session"].commands["list"], async (input) => {
  const { SessionListCommand } = await import("@/cli/cmd/session")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "max-count": Option.getOrUndefined(input["max-count"]),
    "maxCount": Option.getOrUndefined(input["max-count"]),
    "format": input["format"],
  }
  await SessionListCommand.handler(args)
})
