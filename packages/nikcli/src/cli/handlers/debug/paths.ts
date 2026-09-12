import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["paths"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["paths"] as string[], {
  }),
)
