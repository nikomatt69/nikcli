import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["routine"].commands["delete"], async (input) => {
  const { RoutineDeleteCommand } = await import("@/cli/cmd/routine")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": input["id"],
    "yes": Option.getOrUndefined(input["yes"]),
  }
  await RoutineDeleteCommand.handler(args)
})
