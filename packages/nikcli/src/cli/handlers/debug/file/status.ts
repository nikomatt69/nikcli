import { Runtime } from "../../../framework/runtime"
import { Commands } from "../../../commands"
import { EOL } from "os"
import { File } from "@/file"
import { bootstrap } from "@/cli/bootstrap"
import { Effect } from "effect"
import { runFile } from "./shared"

export default Runtime.handler(Commands.commands["debug"].commands["file"].commands["status"], async (_input) => {
  
  await bootstrap(process.cwd(), async () => {
    const status = await runFile(
      Effect.gen(function* () {
        const file = yield* File.Service
        return yield* file.status()
      }),
    )
    process.stdout.write(JSON.stringify(status, null, 2) + EOL)
  })
})
