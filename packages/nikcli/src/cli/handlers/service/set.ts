import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["set"], (input) =>
  delegate(() => import("@/cli/cmd/service"), "ServiceCommand", ["set"] as string[], {
    "key": input["key"],
    "value": input["value"],
    "nested": Option.getOrUndefined(input["nested"]),
  }),
)
