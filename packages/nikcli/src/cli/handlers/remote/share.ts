import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["remote"].commands["share"], async (input) => {
  const { RemoteShareCommand } = await import("@/cli/cmd/remote")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await RemoteShareCommand.handler(args)
})
