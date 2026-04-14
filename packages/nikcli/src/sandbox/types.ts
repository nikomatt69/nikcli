import z from "zod"
import { Identifier } from "@/id/id"
import type { Target } from "@/workspace/adaptors/types"

export namespace Sandbox {
  export const Ref = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("local"),
      directory: z.string(),
    }),
    z.object({
      type: z.literal("workspace"),
      workspaceID: Identifier.schema("workspace"),
    }),
  ])
  export type Ref = z.infer<typeof Ref>

  export const State = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("local"),
    }),
    z.object({
      kind: z.literal("worktree"),
      workspaceID: Identifier.schema("workspace"),
    }),
    z.object({
      kind: z.literal("container"),
      workspaceID: Identifier.schema("workspace"),
      serverURL: z.string().url(),
    }),
  ])
  export type State = z.infer<typeof State>

  export interface Handle {
    ref: Ref
    state: State
    directory: string
    workspaceID?: string
    target(): Promise<Target>
  }
}
