/**
 * Resolution of the optional remote-sync hub settings.
 *
 * Values come from two places, in priority order:
 *  1. `NIKCLI_REMOTE_URL` + `NIKCLI_REMOTE_TOKEN` env vars (always win)
 *  2. the `sync` block of the global config file, settable from the TUI
 *     /sync dialog (POST /sync/config) or by editing nikcli.json directly
 *
 * The TUI polls `/sync/stats` every 2 seconds, so the config-file read is
 * cached with a short TTL; `invalidate()` is called after a config write.
 */
import { Effect } from "effect"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { runPromiseWithLayer } from "@/effect"

export namespace SyncConfig {
  export type Resolved = {
    url?: string
    token?: string
    /** true when both url and token are present */
    configured: boolean
    /** where the effective url + token came from */
    source?: "env" | "config"
    /** bootstrap may auto-connect (NIKCLI_REMOTE_AUTOSTART and config `sync.autostart`) */
    autostart: boolean
  }

  const TTL_MS = 5_000
  let cached: { value: Resolved; at: number } | undefined

  export function invalidate() {
    cached = undefined
  }

  export async function resolve(): Promise<Resolved> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value
    const value = await resolveUncached()
    cached = { value, at: Date.now() }
    return value
  }

  async function resolveUncached(): Promise<Resolved> {
    const envUrl = Flag.NIKCLI_REMOTE_URL?.replace(/\/$/, "")
    const envToken = Flag.NIKCLI_REMOTE_TOKEN
    const saved = envUrl && envToken ? undefined : await readGlobal()
    const url = envUrl ?? saved?.url?.replace(/\/$/, "")
    const token = envToken ?? saved?.token
    const configured = Boolean(url && token)
    return {
      url,
      token,
      configured,
      source: configured ? (envUrl && envToken ? "env" : "config") : undefined,
      autostart: Flag.NIKCLI_REMOTE_AUTOSTART && saved?.autostart !== false,
    }
  }

  async function readGlobal() {
    return runPromiseWithLayer(
      Config.defaultLayer,
      Effect.gen(function* () {
        const config = yield* Config.Service
        return (yield* config.getGlobal()).sync
      }),
    ).catch(() => undefined)
  }
}
