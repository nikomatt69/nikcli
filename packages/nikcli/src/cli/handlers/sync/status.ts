import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { Outbox } from "@/sync/outbox"
import { readRemote } from "./shared"

export default Runtime.handler(Commands.commands["sync"].commands["status"], async (_input) => {
  
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
})
