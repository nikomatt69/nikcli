import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { UI } from "@/cli/ui"
import { service } from "./shared"

export default Runtime.handler(Commands.commands["service"].commands["start"], async (_input) => {
  const BackgroundService = await service()
  const registration = await BackgroundService.ensure()
  UI.println(`nikcli service running on ${registration.url} (pid ${registration.pid})`)
})
