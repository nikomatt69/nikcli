import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["routine"].commands["get"], async (input) => {
  const { RoutineGetCommand } = await import("@/cli/cmd/routine")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": input["id"],
    "format": input["format"],
  }
  await RoutineGetCommand.handler(args)
})
