import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["sync"].commands["token"].commands["create"], async (input) => {
  const { SyncTokenCreateCommand } = await import("@/cli/cmd/sync")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": input["name"],
    "expiry-days": Option.getOrUndefined(input["expiry-days"]),
    "expiryDays": Option.getOrUndefined(input["expiry-days"]),
  }
  await SyncTokenCreateCommand.handler(args)
})
