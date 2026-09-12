import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["sync"].commands["status"], async (input) => {
  const { SyncStatusCommand } = await import("@/cli/cmd/sync")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await SyncStatusCommand.handler(args)
})
