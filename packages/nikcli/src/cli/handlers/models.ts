import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["models"], async (input) => {
  const { ModelsCommand } = await import("@/cli/cmd/models")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "provider": Option.getOrUndefined(input["provider"]),
    "verbose": Option.getOrUndefined(input["verbose"]),
    "refresh": Option.getOrUndefined(input["refresh"]),
  }
  await ModelsCommand.handler(args)
})
