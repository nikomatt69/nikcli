import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["companion"].commands["serve"], (input) =>
  delegate(() => import("@/cli/cmd/companion"), "CompanionCommand", ["serve"] as string[], {
    "port": input["port"],
    "host": input["host"],
  }),
)
