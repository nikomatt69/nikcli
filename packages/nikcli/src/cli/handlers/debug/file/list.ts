import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["file"].commands["list"], async (input) => {
  const { FileListCommand } = await import("@/cli/cmd/debug/file")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "path": input["path"],
  }
  await FileListCommand.handler(args)
})
