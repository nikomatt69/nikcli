import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["sync"].commands["status"], (input) =>
  delegate(() => import("@/cli/cmd/sync"), "SyncCommand", ["status"] as string[], {
  }),
)
