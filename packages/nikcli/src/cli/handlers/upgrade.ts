import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["upgrade"], (input) =>
  delegate(() => import("@/cli/cmd/upgrade"), "UpgradeCommand", [] as string[], {
    "target": Option.getOrUndefined(input["target"]),
    "method": Option.getOrUndefined(input["method"]),
  }),
)
