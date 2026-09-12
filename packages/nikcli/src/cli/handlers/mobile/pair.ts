import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mobile"].commands["pair"], (input) =>
  delegate(() => import("@/cli/cmd/mobile"), "MobileCommand", ["pair"] as string[], {
    "public-url": input["public-url"],
    "name": input["name"],
    "expiry-days": Option.getOrUndefined(input["expiry-days"]),
    "directory": Option.getOrUndefined(input["directory"]),
  }),
)
