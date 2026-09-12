import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"
import { EOL } from "os"
import { File } from "@/file"
import { bootstrap } from "@/cli/bootstrap"
import { Effect } from "effect"
import { runFile } from "./shared"

export default Runtime.handler(Commands.commands["debug"].commands["file"].commands["list"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "path": input["path"],
  }
  await bootstrap(process.cwd(), async () => {
    const files = await runFile(
      Effect.gen(function* () {
        const file = yield* File.Service
        return yield* file.list(args.path)
      }),
    )
    process.stdout.write(JSON.stringify(files, null, 2) + EOL)
  })
})
