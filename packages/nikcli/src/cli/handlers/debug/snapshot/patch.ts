import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["snapshot"].commands["patch"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["snapshot","patch"] as string[], {
    "hash": input["hash"],
  }),
)
