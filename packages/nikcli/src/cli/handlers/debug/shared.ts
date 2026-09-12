import { Skill } from "@/skill"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"

/** Helpers shared by the `skill` commands. */

export function skillAll() {
  return runPromiseWithLayer(
    Skill.defaultLayer,
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      return yield* skill.all()
    }),
  )
}
