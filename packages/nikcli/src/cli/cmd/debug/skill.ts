import { EOL } from "os"
import { Skill } from "../../../skill"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"

function skillAll() {
  return runPromiseWithLayer(
    Skill.defaultLayer,
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      return yield* skill.all()
    }),
  )
}

export const SkillCommand = cmd({
  command: "skill",
  describe: "list all available skills",
  builder: (yargs) => yargs,
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const skills = await skillAll()
      process.stdout.write(JSON.stringify(skills, null, 2) + EOL)
    })
  },
})
