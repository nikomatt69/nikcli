import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["resume"], (input) =>
  delegate(() => import("@/cli/cmd/mission"), "MissionCommand", ["resume"] as string[], {
    "id": input["id"],
  }),
)
