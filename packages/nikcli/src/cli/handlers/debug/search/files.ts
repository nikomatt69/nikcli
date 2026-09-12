import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["search"].commands["files"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["search","files"] as string[], {
    "query": Option.getOrUndefined(input["query"]),
    "glob": Option.getOrUndefined(input["glob"]),
    "limit": Option.getOrUndefined(input["limit"]),
  }),
)
