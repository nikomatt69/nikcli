import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["ads"].commands["enable"], (input) =>
  delegate(() => import("@/cli/cmd/ads"), "AdsCommand", ["enable"] as string[], {
  }),
)
