import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["brain-model"], async (input) => {
  const { BrainModelCommand } = await import("@/cli/cmd/brain-model")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "model": Option.getOrUndefined(input["model"]),
    "reset": input["reset"],
    "global": input["global"],
    "refresh": input["refresh"],
  }
  await BrainModelCommand.handler(args)
})
