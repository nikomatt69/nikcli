import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { EOL } from "os"
import { Skill } from "@/skill"
import { bootstrap } from "@/cli/bootstrap"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"

export function skillAll() {
  return runPromiseWithLayer(
    Skill.defaultLayer,
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      return yield* skill.all()
    }),
  )
}

export default Runtime.handler(Commands.commands["debug"].commands["skill"], async (_input) => {
  await bootstrap(process.cwd(), async () => {
    const skills = await skillAll()
    process.stdout.write(JSON.stringify(skills, null, 2) + EOL)
  })
})
