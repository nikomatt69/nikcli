import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["list"], (input) =>
  delegate(() => import("@/cli/cmd/mission"), "MissionCommand", ["list"] as string[], {
    "format": input["format"],
  }),
)
