import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["usage"], (input) =>
  delegate(() => import("@/cli/cmd/usage"), "UsageCommand", [] as string[], {
    "days": input["days"],
    "top": input["top"],
    "models": input["models"],
    "project": Option.getOrUndefined(input["project"]),
    "no-chart": input["no-chart"],
  }),
)
