import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["mobile"].commands["token"].commands["revoke"], (input) =>
  delegate(() => import("@/cli/cmd/mobile"), "MobileCommand", ["token","revoke"] as string[], {
    "id": input["id"],
  }),
)
