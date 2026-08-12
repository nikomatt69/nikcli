import { Effect } from "effect"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Worktree } from "@/worktree"
import { runProject, runWorktree } from "./helpers"
import { body, isResponse, json } from "./request"

export async function handleWorktreeRequest(request: Request): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname
  if (pathname === "/mobile/worktree" && request.method === "POST") {
    const input = await body(request, Worktree.CreateInput.optional())
    if (isResponse(input)) return input
    const result = await runWorktree(
      Effect.gen(function* () {
        const service = yield* Worktree.Service
        return yield* service.create(input)
      }),
    )
    return json(result)
  }
  if (pathname === "/mobile/worktree/reset" && request.method === "POST") {
    const input = await body(request, Worktree.ResetInput)
    if (isResponse(input)) return input
    await runWorktree(
      Effect.gen(function* () {
        const service = yield* Worktree.Service
        yield* service.reset(input)
      }),
    )
    return json({ success: true })
  }
  if (pathname === "/mobile/worktree" && request.method === "DELETE") {
    const input = await body(request, Worktree.RemoveInput)
    if (isResponse(input)) return input
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
    return json({ success: true })
  }
}
