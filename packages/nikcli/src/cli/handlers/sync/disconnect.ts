import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["sync"].commands["disconnect"], (input) =>
  delegate(() => import("@/cli/cmd/sync"), "SyncCommand", ["disconnect"] as string[], {
  }),
)
