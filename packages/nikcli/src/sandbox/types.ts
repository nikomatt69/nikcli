import { Schema } from "effect"
import { zod } from "@nikcli-ai/util/effect-zod"
import type { Target } from "@/workspace/adaptors/types"

export namespace Sandbox {
  const RefLocal = Schema.Struct({
    type: Schema.Literal("local"),
    directory: Schema.String,
  })

  const RefWorkspace = Schema.Struct({
    type: Schema.Literal("workspace"),
    workspaceID: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
  })

  export const RefSchema = Schema.Union([RefLocal, RefWorkspace])
  export const Ref = zod(RefSchema)
  export type Ref = Schema.Schema.Type<typeof RefSchema>

  const StateLocal = Schema.Struct({
    kind: Schema.Literal("local"),
  })

  const StateWorktree = Schema.Struct({
    kind: Schema.Literal("worktree"),
    workspaceID: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
  })

  const StateContainer = Schema.Struct({
    kind: Schema.Literal("container"),
    workspaceID: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
    serverURL: Schema.String,
  })

  export const StateSchema = Schema.Union([StateLocal, StateWorktree, StateContainer])
  export const State = zod(StateSchema)
  export type State = Schema.Schema.Type<typeof StateSchema>

  export interface Handle {
    ref: Ref
    state: State
    directory: string
    workspaceID?: string
    target(): Promise<Target>
  }
}
