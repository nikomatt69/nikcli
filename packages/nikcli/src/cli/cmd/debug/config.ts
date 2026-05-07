import { EOL } from "os"
import { Config } from "../../../config/config"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

function configGet() {
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

export const ConfigCommand = cmd({
  command: "config",
  describe: "show resolved configuration",
  builder: (yargs) => yargs,
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const config = await configGet()
      process.stdout.write(JSON.stringify(config, null, 2) + EOL)
    })
  },
})
