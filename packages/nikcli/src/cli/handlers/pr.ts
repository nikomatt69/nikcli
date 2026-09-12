import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["pr"], async (input) => {
  const { PrCommand } = await import("@/cli/cmd/pr")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "number": input["number"],
  }
  await PrCommand.handler(args)
})
