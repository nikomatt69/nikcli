import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["start"], (input) =>
  delegate(() => import("@/cli/cmd/mission"), "MissionCommand", ["start"] as string[], {
    "id": input["id"],
    "tail": Option.getOrUndefined(input["tail"]),
  }),
)
