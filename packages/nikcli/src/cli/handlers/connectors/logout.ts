import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["connectors"].commands["logout"], (input) =>
  delegate(() => import("@/cli/cmd/connectors"), "ConnectorsCommand", ["logout"] as string[], {
    "name": Option.getOrUndefined(input["name"]),
  }),
)
