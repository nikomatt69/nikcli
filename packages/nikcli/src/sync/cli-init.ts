/**
 * Bootstrap wiring for the optional remote sync (plan phase 3.4).
 *
 * When `NIKCLI_REMOTE_URL` + `NIKCLI_REMOTE_TOKEN` are set, every
 * bootstrapped instance connects its project to the remote hub — not just
 * the headless `nikcli serve` path. `RemoteSync.start` is idempotent per
 * (url, projectID), so bootstrap, `serve`, and `nikcli sync` can all call
 * it without stacking connections. `NIKCLI_REMOTE_AUTOSTART=false` opts
 * bootstrap out while keeping the explicit commands working.
 */
import { Flag } from "@/flag/flag"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "sync.cli-init" })

export namespace SyncCliInit {
  /**
   * Start remote sync for the current instance's project if the env is
   * configured. Returns a stop function for the instance disposer, or
   * undefined when remote sync is not configured.
   */
  export async function initRemoteSyncFromEnv(): Promise<(() => Promise<void>) | undefined> {
    const url = Flag.NIKCLI_REMOTE_URL?.replace(/\/$/, "")
    const token = Flag.NIKCLI_REMOTE_TOKEN
    if (!url || !token) return undefined
    if (!Flag.NIKCLI_REMOTE_AUTOSTART) {
      log.info("remote sync configured but autostart disabled")
      return undefined
    }

    const projectID = Instance.project.id
    // Lazy import keeps the remote client out of the local-only path.
    const { RemoteSync } = await import("./remote-sync")
    const handle = await RemoteSync.start({ url, token, projectID })
    log.info("remote sync started from bootstrap", { url, projectID })
    return () => handle.stop()
  }
}
