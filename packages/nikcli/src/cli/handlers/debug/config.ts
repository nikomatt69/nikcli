import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { EOL } from "os"
import { Config } from "@/config/config"
import { bootstrap } from "@/cli/bootstrap"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

export function configGet() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    ),
  )
}

export default Runtime.handler(Commands.commands["debug"].commands["config"], async (_input) => {
  
  await bootstrap(process.cwd(), async () => {
    const config = await configGet()
    process.stdout.write(JSON.stringify(config, null, 2) + EOL)
  })
})
