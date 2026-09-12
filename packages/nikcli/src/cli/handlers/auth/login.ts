import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["auth"].commands["login"], (input) =>
  delegate(() => import("@/cli/cmd/auth"), "AuthCommand", ["login"] as string[], {
    "url": Option.getOrUndefined(input["url"]),
    "provider": input["provider"],
    "server": Option.getOrUndefined(input["server"]),
  }),
)
