import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["cancel"], (input) =>
  delegate(() => import("@/cli/cmd/mission"), "MissionCommand", ["cancel"] as string[], {
    "id": input["id"],
  }),
)
