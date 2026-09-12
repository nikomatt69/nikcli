import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["remote"].commands["status"], (input) =>
  delegate(() => import("@/cli/cmd/remote"), "RemoteCommand", ["status"] as string[], {
    "json": Option.getOrUndefined(input["json"]),
  }),
)
