import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["account"].commands["list"], (input) =>
  delegate(() => import("@/cli/cmd/account"), "AccountCommand", ["list"] as string[], {
  }),
)
