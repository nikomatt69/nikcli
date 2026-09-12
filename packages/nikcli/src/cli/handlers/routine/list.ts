import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["routine"].commands["list"], async (input) => {
  const { RoutineListCommand } = await import("@/cli/cmd/routine")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "format": input["format"],
  }
  await RoutineListCommand.handler(args)
})
