import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["sync"].commands["token"].commands["create"], (input) =>
  delegate(() => import("@/cli/cmd/sync"), "SyncCommand", ["token","create"] as string[], {
    "name": input["name"],
    "expiry-days": Option.getOrUndefined(input["expiry-days"]),
  }),
)
