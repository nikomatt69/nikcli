import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"
import { EOL } from "os"
import { File } from "@/file"
import { bootstrap } from "@/cli/bootstrap"
import { Effect } from "effect"
import { runFile } from "./shared"

export default Runtime.handler(Commands.commands["debug"].commands["file"].commands["search"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    query: input["query"],
  }
  await bootstrap(process.cwd(), async () => {
    const results = await runFile(
      Effect.gen(function* () {
        const file = yield* File.Service
        return yield* file.search({ query: args.query })
      }),
    )
    process.stdout.write(results.join(EOL) + EOL)
  })
})
