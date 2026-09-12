import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["snapshot"].commands["diff"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["snapshot","diff"] as string[], {
    "hash": input["hash"],
  }),
)
