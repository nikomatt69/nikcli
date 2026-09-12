import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { UI } from "@/cli/ui"
import { service } from "./shared"

export default Runtime.handler(Commands.commands["service"].commands["status"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    json: input["json"],
  }
  const BackgroundService = await service()
  const status = await BackgroundService.status()
  if (args.json) {
    UI.println(JSON.stringify(status))
    return
  }
  if (!status.running || !status.registration) {
    UI.println(`nikcli service is not running (channel ${status.channel})`)
    return
  }
  const { registration } = status
  UI.println(`nikcli service running on ${registration.url}`)
  UI.println(`  channel  ${status.channel}`)
  UI.println(`  pid      ${registration.pid}`)
  UI.println(`  version  ${registration.version}${status.versionMatches ? "" : " (differs from this client)"}`)
  UI.println(`  started  ${new Date(registration.startedAt).toISOString()}`)
})
