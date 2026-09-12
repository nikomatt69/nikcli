import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["pause"], (input) =>
  delegate(() => import("@/cli/cmd/mission"), "MissionCommand", ["pause"] as string[], {
    "id": input["id"],
  }),
)
