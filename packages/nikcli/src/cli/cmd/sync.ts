import { cmd } from "./cmd"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Project } from "@/project/project"
import { Outbox } from "@/sync/outbox"
import { RemoteSync } from "@/sync/remote-sync"

const log = Log.create({ service: "cli.sync" })

async function readEnv(): Promise<{ url: string; token: string } | undefined> {
  const url = process.env.NIKCLI_REMOTE_URL?.replace(/\/$/, "")
  const token = process.env.NIKCLI_REMOTE_TOKEN
  if (!url || !token) return undefined
  return { url, token }
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
          const env = await readEnv()
          if (!env) {
            console.log("remote sync not configured")
            console.log("set NIKCLI_REMOTE_URL and NIKCLI_REMOTE_TOKEN to enable")
            return
          }
          const outbox = Outbox.status(env.url)
          console.log(`target:        ${env.url}`)
          console.log(`outbox pending: ${outbox.pending}`)
          console.log(`outbox failed:  ${outbox.failed}`)
          console.log(`outbox total:   ${outbox.total}`)
        },
      })
      .command({
        command: "connect",
        describe: "force a connection to the configured remote hub",
        handler: async () => {
          const env = await readEnv()
          if (!env) {
            console.log("remote sync not configured")
            return
          }
          const projectID = Instance.project.id
          log.info("forcing remote sync start", { url: env.url, projectID })
          const handle = await RemoteSync.start({ ...env, projectID })
          console.log(`connected to ${env.url} (project ${projectID})`)
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
      .demandCommand()
      .help(),
  handler: async () => {},
})
