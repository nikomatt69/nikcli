import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["analytics"].commands["publish"], async (input) => {
  const { AnalyticsPublishCommand } = await import("@/cli/cmd/analytics")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "today": input["today"],
    "week": input["week"],
    "month": input["month"],
    "all": input["all"],
  }
  await AnalyticsPublishCommand.handler(args)
})
