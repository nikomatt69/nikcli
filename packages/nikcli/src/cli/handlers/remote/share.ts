import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["remote"].commands["share"], (input) =>
  delegate(() => import("@/cli/cmd/remote"), "RemoteCommand", ["share"] as string[], {
  }),
)
