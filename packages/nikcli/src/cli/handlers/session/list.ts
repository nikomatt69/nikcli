import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["session"].commands["list"], (input) =>
  delegate(() => import("@/cli/cmd/session"), "SessionCommand", ["list"] as string[], {
    "max-count": Option.getOrUndefined(input["max-count"]),
    "format": input["format"],
  }),
)
