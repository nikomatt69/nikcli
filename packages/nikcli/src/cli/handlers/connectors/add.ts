import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["connectors"].commands["add"], (input) =>
  delegate(() => import("@/cli/cmd/connectors"), "ConnectorsCommand", ["add"] as string[], {
  }),
)
