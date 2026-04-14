import { Session } from "@/session"
import { Workspace } from "@/workspace"
import { getAdaptor } from "@/workspace/adaptors"
import { Sandbox } from "./types"

function stateFromWorkspace(workspace: Workspace.Info): Sandbox.State {
  switch (workspace.config.type) {
    case "worktree":
      return {
        kind: "worktree",
        workspaceID: workspace.id,
      }
    case "container":
      return {
        kind: "container",
        workspaceID: workspace.id,
        serverURL: workspace.config.serverUrl,
      }
  }
}

export namespace SandboxRegistry {
  export function refForSession(input: Pick<Session.Info, "directory" | "workspaceID">): Sandbox.Ref {
    if (input.workspaceID) {
      return {
        type: "workspace",
        workspaceID: input.workspaceID,
      }
    }

    return {
      type: "local",
      directory: input.directory,
    }
  }

  export async function fromSession(input: Pick<Session.Info, "directory" | "workspaceID">): Promise<Sandbox.Handle> {
    return resolve(refForSession(input))
  }

  export async function resolve(ref: Sandbox.Ref): Promise<Sandbox.Handle> {
    if (ref.type === "local") {
      return {
        ref,
        state: { kind: "local" },
        directory: ref.directory,
        async target() {
          return {
            type: "local",
            directory: ref.directory,
          }
        },
      }
    }

    const workspace = await Workspace.get(ref.workspaceID)
    if (!workspace) {
      throw new Error(`Sandbox workspace \"${ref.workspaceID}\" not found`)
    }

    const adaptor = getAdaptor(workspace.config)
    return {
      ref,
      state: stateFromWorkspace(workspace),
      directory: workspace.config.directory,
      workspaceID: workspace.id,
      async target() {
        return Promise.resolve(adaptor.target(workspace.config))
      },
    }
  }
}
