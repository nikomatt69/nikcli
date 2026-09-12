import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["api"], async (input) => {
  const { ApiCommand } = await import("@/cli/cmd/api")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "request": input["request"],
    "data": Option.getOrUndefined(input["data"]),
    "param": input["param"],
    "header": input["header"],
    "list": Option.getOrUndefined(input["list"]),
    "directory": Option.getOrUndefined(input["directory"]),
  }
  await ApiCommand.handler(args)
})
