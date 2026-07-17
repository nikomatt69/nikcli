import { cmd } from "./cmd"
import { Log } from "@/util/log"
import { withInstanceAsync } from "@/effect"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Outbox } from "@/sync/outbox"
import { RemoteSync } from "@/sync/remote-sync"
import { SyncConfig } from "@/sync/sync-config"

const log = Log.create({ service: "cli.sync" })

export type SyncRemoteConfig = {
  url: string
  token: string
  source?: "env" | "config" | "account"
}

async function readRemote(): Promise<SyncRemoteConfig | undefined> {
  const resolved = await SyncConfig.resolve()
  if (!resolved.url || !resolved.token) return undefined
  return { url: resolved.url, token: resolved.token, source: resolved.source }
}

export type RemoteSyncHandleLike = { stop: () => Promise<void> }

export type SyncConnectDeps = {
  readRemote: () => Promise<SyncRemoteConfig | undefined>
  withInstance: typeof withInstanceAsync
  getProjectId: () => string
  remoteStart: (opts: { url: string; token: string; projectID: string }) => Promise<RemoteSyncHandleLike>
  onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void
  offSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void
}

/** CLI `sync connect` body (injectable for tests). */
export async function runSyncConnect(deps: SyncConnectDeps): Promise<void> {
  await deps.withInstance({ directory: process.cwd(), init: InstanceBootstrap }, async () => {
    const remote = await deps.readRemote()
    if (!remote) {
      console.log("remote sync not configured")
      process.exitCode = 1
      return
    }
    const projectID = deps.getProjectId()
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

export const SyncCommand = cmd({
  command: "sync",
  describe: "manage optional remote hub sync (e.g. https://s.nikcli.store)",
  builder: (yargs) =>
    yargs
      .command({
        command: "status",
        describe: "show outbox state and last-seen sequence",
        handler: async () => {
          const remote = await readRemote()
          if (!remote) {
            console.log("remote sync not configured")
            console.log("set NIKCLI_REMOTE_URL and NIKCLI_REMOTE_TOKEN, or use /sync in the TUI to save it")
            return
          }
          const outbox = Outbox.status(remote.url)
          console.log(`target:        ${remote.url} (${remote.source === "env" ? "env vars" : "config file"})`)
          console.log(`outbox pending: ${outbox.pending}`)
          console.log(`outbox failed:  ${outbox.failed}`)
          console.log(`outbox total:   ${outbox.total}`)
        },
      })
      .command({
        command: "connect",
        describe: "force a connection to the configured remote hub",
        handler: async () => {
          await runSyncConnect({
            readRemote,
            withInstance: withInstanceAsync,
            getProjectId: () => Instance.project.id,
            remoteStart: (opts) =>
              RemoteSync.start({
                ...opts,
                resolveToken: SyncConfig.refreshToken,
              }),
            onSignal: (signal, handler) => process.once(signal, handler),
            offSignal: (signal, handler) => process.off(signal, handler),
          })
        },
      })
      .command({
        command: "disconnect",
        describe: "show how to end an active sync connect session (no separate stop API)",
        handler: async () => {
          console.log("To end an active connection, stop the process that ran `nikcli sync connect` (e.g. Ctrl-C).")
          console.log("Queued events in the outbox are sent on the next connect.")
        },
      })
      .command({
        command: "token create",
        describe: "create a cli-sync scoped token for connecting a CLI to this hub",
        builder: (inner) =>
          inner
            .option("name", {
              type: "string",
              default: "cli-sync",
              describe: "token label",
            })
            .option("expiry-days", {
              type: "number",
              describe: "optional token expiry in days",
            }),
        handler: async (args) => {
          const { MobileAuth } = await import("@/mobile/auth")
          const created = await MobileAuth.create({
            name: String(args.name || "cli-sync"),
            expiresInDays: args.expiryDays ? Number(args.expiryDays) : undefined,
            scope: "cli-sync",
          })
          console.log(`token id: ${created.info.id} (scope: cli-sync)`)
          console.log(`NIKCLI_REMOTE_TOKEN=${created.token}`)
          console.log("store the token now — it cannot be shown again")
        },
      })
      .demandCommand()
      .help(),
  handler: async () => {},
})
