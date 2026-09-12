import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["heap"], async (input) => {
  const { HeapCommand } = await import("@/cli/cmd/heap")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "detailed": Option.getOrUndefined(input["detailed"]),
  }
  await HeapCommand.handler(args)
})
