import { Log } from "@nikcli-ai/util/log"
import { SyncEvent } from "./sync-event"

const log = Log.create({ service: "sync-projectors" })

let installed = false

/**
 * Install every projector and freeze the sync event registry.
 *
 * The counterpart to opencode 2.0's `server/projectors.ts`. It must run
 * before the first `SyncEvent.run`, which is why `run` calls it lazily as
 * well as bootstrap calling it eagerly — a domain write must never be the
 * thing that discovers the system was not wired up.
 *
 * The import is dynamic so this module carries no dependency on the session
 * import graph (which reaches the AI SDKs); see specs/startup-performance.md.
 */
export async function installProjectors(): Promise<void> {
  if (installed) return
  installed = true
  try {
    const { SessionSync } = await import("@/session/projectors")
    SessionSync.install()
  } catch (error) {
    installed = false
    log.error("failed to install sync projectors", { error })
    throw error
  }
}

/** Test hook: drop projectors so a suite can re-install them. */
export function resetProjectors() {
  installed = false
  SyncEvent.reset()
}
