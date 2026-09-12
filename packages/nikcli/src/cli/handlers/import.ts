import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["import"], async (input) => {
  const { ImportCommand } = await import("@/cli/cmd/import")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "file": input["file"],
  }
  await ImportCommand.handler(args)
})
