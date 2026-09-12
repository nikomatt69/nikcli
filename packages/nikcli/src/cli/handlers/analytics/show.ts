import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["analytics"].commands["show"], (input) =>
  delegate(() => import("@/cli/cmd/analytics"), "AnalyticsCommand", ["show"] as string[], {
    "today": input["today"],
    "week": input["week"],
    "month": input["month"],
    "all": input["all"],
    "json": input["json"],
  }),
)
