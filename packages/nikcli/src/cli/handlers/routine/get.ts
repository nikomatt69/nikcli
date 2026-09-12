import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["routine"].commands["get"], (input) =>
  delegate(() => import("@/cli/cmd/routine"), "RoutineCommand", ["get"] as string[], {
    "id": input["id"],
    "format": input["format"],
  }),
)
