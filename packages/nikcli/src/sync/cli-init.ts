/**
 * Bootstrap wiring for the optional remote sync (plan phase 3.4).
 *
 * When the hub is configured — `NIKCLI_REMOTE_URL` + `NIKCLI_REMOTE_TOKEN`
 * env vars or the `sync` block of the global config file (see
 * `SyncConfig.resolve`) — every bootstrapped instance connects its project
 * to the remote hub, not just the headless `nikcli serve` path.
 * `RemoteSync.start` is idempotent per (url, projectID), so bootstrap,
 * `serve`, and `nikcli sync` can all call it without stacking connections.
 * `NIKCLI_REMOTE_AUTOSTART=false` (or `sync.autostart: false`) opts
 * bootstrap out while keeping the explicit commands working.
 */
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { SyncConfig } from "./sync-config"

const log = Log.create({ service: "sync.cli-init" })

export namespace SyncCliInit {
  /**
   * Start remote sync for the current instance's project if the hub is
   * configured. Returns a stop function for the instance disposer, or
   * undefined when remote sync is not configured.
   */
  export async function initRemoteSyncFromEnv(): Promise<(() => Promise<void>) | undefined> {
    const resolved = await SyncConfig.resolve()
    if (!resolved.url || !resolved.token) return undefined
    if (!resolved.autostart) {
      log.info("remote sync configured but autostart disabled")
      return undefined
    }

    const projectID = Instance.project.id
    // Lazy import keeps the remote client out of the local-only path.
    const { RemoteSync } = await import("./remote-sync")
    const handle = await RemoteSync.start({ url: resolved.url, token: resolved.token, projectID })
    log.info("remote sync started from bootstrap", { url: resolved.url, projectID, source: resolved.source })
    return () => handle.stop()
  }

  /**
   * Start remote sync for every known project. Used by `nikcli serve` and
   * by the `/sync/config` + `/sync/connect` server routes, which have no
   * instance context to derive a single project from.
   */
  export async function startForAllProjects(opts: {
    url: string
    token: string
  }): Promise<{ count: number; stop(): Promise<void> }> {
    const { Project } = await import("@/project/project")
    const { runPromiseWithLayer } = await import("@/effect")
    const { Effect } = await import("effect")
    const projects = await runPromiseWithLayer(
      Project.defaultLayer,
      Effect.gen(function* () {
        const project = yield* Project.Service
        return yield* project.list()
      }),
    )
    const { RemoteSync } = await import("./remote-sync")
    const handles = await Promise.all(
      projects.map((project) =>
        RemoteSync.start({ url: opts.url, token: opts.token, projectID: project.id }).catch((error) => {
          log.warn("remote sync start failed", { projectID: project.id, error })
          return undefined
        }),
      ),
    )
    const valid = handles.filter((handle): handle is NonNullable<typeof handle> => Boolean(handle))
    log.info("remote sync wired", { url: opts.url, projects: valid.length })
    return {
      count: valid.length,
      async stop() {
        await Promise.all(valid.map((handle) => handle.stop()))
      },
    }
  }
}
