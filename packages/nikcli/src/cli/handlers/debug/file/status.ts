import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["file"].commands["status"], async (input) => {
  const { FileStatusCommand } = await import("@/cli/cmd/debug/file")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await FileStatusCommand.handler(args)
})
