import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["account"].commands["login"], (input) =>
  delegate(() => import("@/cli/cmd/account"), "AccountCommand", ["login"] as string[], {
    "server": Option.getOrUndefined(input["server"]),
  }),
)
