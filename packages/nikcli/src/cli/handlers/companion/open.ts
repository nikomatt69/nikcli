import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["companion"].commands["open"], (input) =>
  delegate(() => import("@/cli/cmd/companion"), "CompanionCommand", ["open"] as string[], {
    "port": input["port"],
    "session": Option.getOrUndefined(input["session"]),
  }),
)
