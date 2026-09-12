import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["companion"].commands["serve"], async (input) => {
  const { CompanionServeCommand } = await import("@/cli/cmd/companion")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "port": input["port"],
    "host": input["host"],
  }
  await CompanionServeCommand.handler(args)
})
