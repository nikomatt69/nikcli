import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["remote"].commands["attach"], async (input) => {
  const { RemoteAttachCommand } = await import("@/cli/cmd/remote")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await RemoteAttachCommand.handler(args)
})
