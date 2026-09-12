import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["lsp"].commands["document-symbols"], async (input) => {
  const { DocumentSymbolsCommand } = await import("@/cli/cmd/debug/lsp")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "uri": input["uri"],
  }
  await DocumentSymbolsCommand.handler(args)
})
