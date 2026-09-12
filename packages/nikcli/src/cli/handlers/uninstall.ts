import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["uninstall"], (input) =>
  delegate(() => import("@/cli/cmd/uninstall"), "UninstallCommand", [] as string[], {
    "keep-config": input["keep-config"],
    "keep-data": input["keep-data"],
    "dry-run": input["dry-run"],
    "force": input["force"],
  }),
)
