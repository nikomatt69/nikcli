import { EOL } from "os"
import { Project } from "../../../project/project"
import { Log } from "../../../util/log"
import { cmd } from "../cmd"
import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"

function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runPromiseWithLayer(Project.defaultLayer, effect)
}

export const ScrapCommand = cmd({
  command: "scrap",
  describe: "list all known projects",
  builder: (yargs) => yargs,
  async handler() {
    const timer = Log.Default.time("scrap")
    const list = await runProject(
      Effect.gen(function* () {
        const project = yield* Project.Service
        return yield* project.list()
      }),
    )
    process.stdout.write(JSON.stringify(list, null, 2) + EOL)
    timer.stop()
  },
})
