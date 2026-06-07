import { Context } from "../util/context"

interface WorkspaceContextData {
  workspaceID?: string
}

const context = Context.create<WorkspaceContextData>("workspace")

export const WorkspaceContext = {
  async provide<R>(input: { workspaceID?: string; fn: () => R }): Promise<R> {
    return context.provide({ workspaceID: input.workspaceID }, async () => {
      return input.fn()
    })
  },

  restore<R>(workspaceID: string, fn: () => R): R {
    return context.provide({ workspaceID }, fn)
  },

  get workspaceID() {
    try {
      return context.use().workspaceID
    } catch {
      return undefined
    }
  },
}
