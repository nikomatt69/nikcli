import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["sync"].commands["connect"], async (input) => {
  const { SyncConnectCommand } = await import("@/cli/cmd/sync")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await SyncConnectCommand.handler(args)
})
