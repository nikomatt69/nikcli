import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["start"], (input) =>
  delegate(() => import("@/cli/cmd/service"), "ServiceCommand", ["start"] as string[], {
  }),
)
