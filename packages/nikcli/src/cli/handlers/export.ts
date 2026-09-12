import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["export"], async (input) => {
  const { ExportCommand } = await import("@/cli/cmd/export")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "sessionID": Option.getOrUndefined(input["sessionID"]),
  }
  await ExportCommand.handler(args)
})
