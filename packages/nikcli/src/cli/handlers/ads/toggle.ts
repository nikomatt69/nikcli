import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["ads"].commands["toggle"], (input) =>
  delegate(() => import("@/cli/cmd/ads"), "AdsCommand", ["toggle"] as string[], {
    "id": Option.getOrUndefined(input["id"]),
  }),
)
