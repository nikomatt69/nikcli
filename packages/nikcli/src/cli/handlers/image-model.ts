import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["image-model"], async (input) => {
  const { ImageModelCommand } = await import("@/cli/cmd/image-model")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "provider": Option.getOrUndefined(input["provider"]),
    "model": Option.getOrUndefined(input["model"]),
    "reset": input["reset"],
    "global": input["global"],
    "refresh": input["refresh"],
  }
  await ImageModelCommand.handler(args)
})
