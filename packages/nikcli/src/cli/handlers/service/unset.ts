import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["unset"], (input) =>
  delegate(() => import("@/cli/cmd/service"), "ServiceCommand", ["unset"] as string[], {
    "key": input["key"],
    "nested": Option.getOrUndefined(input["nested"]),
  }),
)
