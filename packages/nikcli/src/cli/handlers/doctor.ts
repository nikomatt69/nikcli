import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["doctor"], (input) =>
  delegate(() => import("@/cli/cmd/doctor"), "DoctorCommand", [] as string[], {
    "json": Option.getOrUndefined(input["json"]),
  }),
)
