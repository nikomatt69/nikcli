import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { UI } from "@/cli/ui"
import { service } from "./shared"

export default Runtime.handler(Commands.commands["service"].commands["restart"], async (_input) => {
  
  const BackgroundService = await service()
  await BackgroundService.stop()
  const registration = await BackgroundService.start()
  UI.println(`nikcli service running on ${registration.url} (pid ${registration.pid})`)
})
