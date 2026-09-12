import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["remote"].commands["stop"], (input) =>
  delegate(() => import("@/cli/cmd/remote"), "RemoteCommand", ["stop"] as string[], {
  }),
)
