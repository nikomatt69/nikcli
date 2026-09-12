import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["ads"].commands["create"], (input) =>
  delegate(() => import("@/cli/cmd/ads"), "AdsCommand", ["create"] as string[], {
    "id": Option.getOrUndefined(input["id"]),
    "text": Option.getOrUndefined(input["text"]),
    "url": Option.getOrUndefined(input["url"]),
    "disabled": Option.getOrUndefined(input["disabled"]),
  }),
)
