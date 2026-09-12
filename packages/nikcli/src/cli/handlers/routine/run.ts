import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["routine"].commands["run"], (input) =>
  delegate(() => import("@/cli/cmd/routine"), "RoutineCommand", ["run"] as string[], {
    "id": input["id"],
    "text": Option.getOrUndefined(input["text"]),
  }),
)
