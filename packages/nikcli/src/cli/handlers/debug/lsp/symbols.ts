import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"
import { LSP } from "@/lsp"
import { bootstrap } from "@/cli/bootstrap"
import { Log } from "@nikcli-ai/util/log"
import { EOL } from "os"
import { Effect } from "effect"
import { runLSP } from "./shared"

export default Runtime.handler(Commands.commands["debug"].commands["lsp"].commands["symbols"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    query: input["query"],
  }
  await bootstrap(process.cwd(), async () => {
    using _ = Log.Default.time("symbols")
    const results = await runLSP(
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        return yield* lsp.workspaceSymbol(args.query)
      }),
    )
    process.stdout.write(JSON.stringify(results, null, 2) + EOL)
  })
})
