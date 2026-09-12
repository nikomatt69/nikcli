import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"
import { LSP } from "@/lsp"
import { bootstrap } from "@/cli/bootstrap"
import { EOL } from "os"
import { Effect } from "effect"
import { runLSP } from "./shared"

export default Runtime.handler(Commands.commands["debug"].commands["lsp"].commands["diagnostics"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    file: input["file"],
  }
  await bootstrap(process.cwd(), async () => {
    await runLSP(
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        yield* lsp.touchFile(args.file, true)
      }),
    )
    await Bun.sleep(1000)
    const diagnostics = await runLSP(
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        return yield* lsp.diagnostics()
      }),
    )
    process.stdout.write(JSON.stringify(diagnostics, null, 2) + EOL)
  })
})
