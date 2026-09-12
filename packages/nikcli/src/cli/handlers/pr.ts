import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["pr"], (input) =>
  delegate(() => import("@/cli/cmd/pr"), "PrCommand", [] as string[], {
    "number": input["number"],
  }),
)
