import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["get"], (input) =>
  delegate(() => import("@/cli/cmd/service"), "ServiceCommand", ["get"] as string[], {
    "key": Option.getOrUndefined(input["key"]),
  }),
)
