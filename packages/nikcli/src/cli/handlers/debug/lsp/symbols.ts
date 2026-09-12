import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["lsp"].commands["symbols"], async (input) => {
  const { SymbolsCommand } = await import("@/cli/cmd/debug/lsp")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "query": input["query"],
  }
  await SymbolsCommand.handler(args)
})
