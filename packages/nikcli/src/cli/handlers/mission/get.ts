import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["get"], (input) =>
  delegate(() => import("@/cli/cmd/mission"), "MissionCommand", ["get"] as string[], {
    "id": input["id"],
    "format": input["format"],
  }),
)
