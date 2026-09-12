import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["restart"], (input) =>
  delegate(() => import("@/cli/cmd/service"), "ServiceCommand", ["restart"] as string[], {
  }),
)
