import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["wait"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["wait"] as string[], {
  }),
)
