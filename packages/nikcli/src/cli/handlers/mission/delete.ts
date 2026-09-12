import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["delete"], (input) =>
  delegate(() => import("@/cli/cmd/mission"), "MissionCommand", ["delete"] as string[], {
    "id": input["id"],
    "yes": Option.getOrUndefined(input["yes"]),
  }),
)
