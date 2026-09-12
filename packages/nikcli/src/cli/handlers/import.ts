import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["import"], (input) =>
  delegate(() => import("@/cli/cmd/import"), "ImportCommand", [] as string[], {
    "file": input["file"],
  }),
)
