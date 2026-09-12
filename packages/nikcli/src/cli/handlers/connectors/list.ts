import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["connectors"].commands["list"], (input) =>
  delegate(() => import("@/cli/cmd/connectors"), "ConnectorsCommand", ["list"] as string[], {
  }),
)
