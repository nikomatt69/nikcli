import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["lsp"].commands["diagnostics"], async (input) => {
  const { DiagnosticsCommand } = await import("@/cli/cmd/debug/lsp")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "file": input["file"],
  }
  await DiagnosticsCommand.handler(args)
})
