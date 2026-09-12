import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["analytics"].commands["publish"], (input) =>
  delegate(() => import("@/cli/cmd/analytics"), "AnalyticsCommand", ["publish"] as string[], {
    "today": input["today"],
    "week": input["week"],
    "month": input["month"],
    "all": input["all"],
  }),
)
