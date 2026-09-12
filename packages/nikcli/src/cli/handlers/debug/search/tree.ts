import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["search"].commands["tree"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["search","tree"] as string[], {
    "limit": Option.getOrUndefined(input["limit"]),
  }),
)
