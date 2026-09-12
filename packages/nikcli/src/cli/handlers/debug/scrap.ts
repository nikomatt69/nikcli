import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { EOL } from "os"
import { Project } from "@/project/project"
import { Log } from "@nikcli-ai/util/log"
import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"

export function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runPromiseWithLayer(Project.defaultLayer, effect)
}

export default Runtime.handler(Commands.commands["debug"].commands["scrap"], async (_input) => {
  
  const timer = Log.Default.time("scrap")
  const list = await runProject(
    Effect.gen(function* () {
      const project = yield* Project.Service
      return yield* project.list()
    }),
  )
  process.stdout.write(JSON.stringify(list, null, 2) + EOL)
  timer.stop()
})
