import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["export"], (input) =>
  delegate(() => import("@/cli/cmd/export"), "ExportCommand", [] as string[], {
    "sessionID": Option.getOrUndefined(input["sessionID"]),
  }),
)
