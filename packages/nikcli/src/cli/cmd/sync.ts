import { cmd } from "./cmd"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Outbox } from "@/sync/outbox"
import { RemoteSync } from "@/sync/remote-sync"
import { SyncConfig } from "@/sync/sync-config"

const log = Log.create({ service: "cli.sync" })

async function readRemote(): Promise<{ url: string; token: string; source?: "env" | "config" } | undefined> {
  const resolved = await SyncConfig.resolve()
  if (!resolved.url || !resolved.token) return undefined
  return { url: resolved.url, token: resolved.token, source: resolved.source }
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
          const remote = await readRemote()
          if (!remote) {
            console.log("remote sync not configured")
            return
          }
          const projectID = Instance.project.id
          log.info("forcing remote sync start", { url: remote.url, projectID })
          const handle = await RemoteSync.start({ url: remote.url, token: remote.token, projectID })
          console.log(`connected to ${remote.url} (project ${projectID})`)
          console.log("press Ctrl-C to disconnect")
          await new Promise(() => {})
          await handle.stop()
        },
      })
      .command({
        command: "disconnect",
        describe: "abort the active connection (events remain queued in outbox)",
        handler: async () => {
          console.log("disconnect is implicit — stopping the CLI will close the connection")
          console.log("queued events in the outbox will be sent on next connect")
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
