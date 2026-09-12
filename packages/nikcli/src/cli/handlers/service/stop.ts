import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { UI } from "@/cli/ui"
import { service } from "./shared"

export default Runtime.handler(Commands.commands["service"].commands["stop"], async (_input) => {
  const BackgroundService = await service()
  const stopped = await BackgroundService.stop()
  UI.println(stopped ? "nikcli service stopped" : "nikcli service was not running")
})
