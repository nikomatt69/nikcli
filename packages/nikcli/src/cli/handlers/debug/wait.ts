import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["wait"], async (input) => {
  const { WaitCommand } = await import("@/cli/cmd/debug/index")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await WaitCommand.handler(args)
})
