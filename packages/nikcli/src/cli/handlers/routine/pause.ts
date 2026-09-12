import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["routine"].commands["pause"], (input) =>
  delegate(() => import("@/cli/cmd/routine"), "RoutineCommand", ["pause"] as string[], {
    "id": input["id"],
  }),
)
