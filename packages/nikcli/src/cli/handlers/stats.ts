import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["stats"], (input) =>
  delegate(() => import("@/cli/cmd/stats"), "StatsCommand", [] as string[], {
    "days": Option.getOrUndefined(input["days"]),
    "tools": Option.getOrUndefined(input["tools"]),
    "models": Option.getOrUndefined(input["models"]),
    "project": Option.getOrUndefined(input["project"]),
  }),
)
