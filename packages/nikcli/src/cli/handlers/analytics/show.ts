import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["analytics"].commands["show"], async (input) => {
  const { AnalyticsShowCommand } = await import("@/cli/cmd/analytics")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "today": input["today"],
    "week": input["week"],
    "month": input["month"],
    "all": input["all"],
    "json": input["json"],
  }
  await AnalyticsShowCommand.handler(args)
})
