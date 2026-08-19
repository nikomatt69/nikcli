import { Effect } from "effect"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Worktree } from "@/worktree"
import { runProject, runWorktree } from "./helpers"

export function create(input: typeof Worktree.CreateInput._output | void) {
  return runWorktree(
    Effect.gen(function* () {
      const service = yield* Worktree.Service
      return yield* service.create(input ?? {})
    }),
  )
}

export async function reset(input: typeof Worktree.ResetInput._output) {
  await runWorktree(
    Effect.gen(function* () {
      const service = yield* Worktree.Service
      yield* service.reset(input)
    }),
  )
  return { success: true as const }
}

export async function remove(input: typeof Worktree.RemoveInput._output) {
  await runWorktree(
    Effect.gen(function* () {
      const service = yield* Worktree.Service
      yield* service.remove(input)
    }),
  )
  await runProject(
    Effect.gen(function* () {
      const project = yield* Project.Service
      yield* project.removeSandbox(Instance.project.id, input.directory)
    }),
  ).catch(() => undefined)
  return { success: true as const }
}
