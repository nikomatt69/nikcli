import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["search"].commands["content"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["search","content"] as string[], {
    "pattern": input["pattern"],
    "mode": input["mode"],
    "limit": Option.getOrUndefined(input["limit"]),
  }),
)
