import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["sync"].commands["connect"], (input) =>
  delegate(() => import("@/cli/cmd/sync"), "SyncCommand", ["connect"] as string[], {
  }),
)
