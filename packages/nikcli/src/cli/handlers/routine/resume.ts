import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["routine"].commands["resume"], (input) =>
  delegate(() => import("@/cli/cmd/routine"), "RoutineCommand", ["resume"] as string[], {
    "id": input["id"],
  }),
)
