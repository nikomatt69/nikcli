import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["file"].commands["read"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["file","read"] as string[], {
    "path": input["path"],
  }),
)
