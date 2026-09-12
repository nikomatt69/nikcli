import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["paths"], async (input) => {
  const { PathsCommand } = await import("@/cli/cmd/debug/index")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await PathsCommand.handler(args)
})
