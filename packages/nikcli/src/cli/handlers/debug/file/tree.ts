import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["file"].commands["tree"], async (input) => {
  const { FileTreeCommand } = await import("@/cli/cmd/debug/file")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "dir": input["dir"],
  }
  await FileTreeCommand.handler(args)
})
