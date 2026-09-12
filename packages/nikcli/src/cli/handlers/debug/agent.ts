import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["agent"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["agent"] as string[], {
    "name": input["name"],
    "tool": Option.getOrUndefined(input["tool"]),
    "params": Option.getOrUndefined(input["params"]),
  }),
)
