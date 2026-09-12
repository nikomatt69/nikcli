import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["remote"].commands["attach"], (input) =>
  delegate(() => import("@/cli/cmd/remote"), "RemoteCommand", ["attach"] as string[], {
  }),
)
