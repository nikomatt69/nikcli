import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["file"].commands["tree"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["file","tree"] as string[], {
    "dir": input["dir"],
  }),
)
