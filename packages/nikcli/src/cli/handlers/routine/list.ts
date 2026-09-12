import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["routine"].commands["list"], (input) =>
  delegate(() => import("@/cli/cmd/routine"), "RoutineCommand", ["list"] as string[], {
    "format": input["format"],
  }),
)
