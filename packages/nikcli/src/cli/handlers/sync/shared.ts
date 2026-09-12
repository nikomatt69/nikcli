import { Log } from "@nikcli-ai/util/log"
import { withInstanceAsync, type InstanceContext } from "@/effect"
import { InstanceBootstrap } from "@/project/bootstrap"
import { SyncConfig } from "@/sync/sync-config"

/** Helpers shared by the `sync` commands. */

export const log = Log.create({ service: "cli.sync" })

export type SyncRemoteConfig = {
  url: string
  token: string
  source?: "env" | "config" | "account"
}

export async function readRemote(): Promise<SyncRemoteConfig | undefined> {
  const resolved = await SyncConfig.resolve()
  if (!resolved.url || !resolved.token) return undefined
  return { url: resolved.url, token: resolved.token, source: resolved.source }
}

export type RemoteSyncHandleLike = { stop: () => Promise<void> }

export type SyncConnectDeps = {
  readRemote: () => Promise<SyncRemoteConfig | undefined>
  withInstance: typeof withInstanceAsync
  getProjectId: (instance: InstanceContext) => string
  remoteStart: (opts: { url: string; token: string; projectID: string }) => Promise<RemoteSyncHandleLike>
  onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void
  offSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void
}

/** CLI `sync connect` body (injectable for tests). */
export async function runSyncConnect(deps: SyncConnectDeps): Promise<void> {
  await deps.withInstance({ directory: process.cwd(), init: InstanceBootstrap }, async (instance) => {
    const remote = await deps.readRemote()
    if (!remote) {
      console.log("remote sync not configured")
      process.exitCode = 1
      return
    }
    const projectID = deps.getProjectId(instance)
    log.info("forcing remote sync start", {
      url: remote.url,
      projectID,
    })
    const handle = await deps.remoteStart({
      url: remote.url,
      token: remote.token,
      projectID,
    })
    console.log(`connected to ${remote.url} (project ${projectID})`)
    console.log("press Ctrl-C to disconnect")
    await new Promise<void>((resolve) => {
      let closing = false
      const close = () => {
        if (closing) return
        closing = true
        deps.offSignal("SIGINT", close)
        deps.offSignal("SIGTERM", close)
        void handle.stop().finally(resolve)
      }
      deps.onSignal("SIGINT", close)
      deps.onSignal("SIGTERM", close)
    })
  })
}
