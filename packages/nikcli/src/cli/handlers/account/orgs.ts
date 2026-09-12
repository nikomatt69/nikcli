import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["account"].commands["orgs"], (input) =>
  delegate(() => import("@/cli/cmd/account"), "AccountCommand", ["orgs"] as string[], {
    "account-id": Option.getOrUndefined(input["account-id"]),
  }),
)
