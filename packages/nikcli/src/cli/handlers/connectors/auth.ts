import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["connectors"].commands["auth"], (input) =>
  delegate(() => import("@/cli/cmd/connectors"), "ConnectorsCommand", ["auth"] as string[], {
    "name": Option.getOrUndefined(input["name"]),
  }),
)
