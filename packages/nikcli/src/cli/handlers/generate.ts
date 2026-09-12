import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["generate"], async (input) => {
  const { GenerateCommand } = await import("@/cli/cmd/generate")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await GenerateCommand.handler(args)
})
