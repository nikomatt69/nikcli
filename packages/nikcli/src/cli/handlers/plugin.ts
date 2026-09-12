import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["plugin"], (input) =>
  delegate(() => import("@/cli/cmd/plug"), "PluginCommand", [] as string[], {
    "module": input["module"],
    "global": input["global"],
    "force": input["force"],
  }),
)
