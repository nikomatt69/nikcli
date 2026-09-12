import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mobile"].commands["pair"], async (input) => {
  const { MobilePairCommand } = await import("@/cli/cmd/mobile")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "public-url": input["public-url"],
    "publicUrl": input["public-url"],
    "name": input["name"],
    "expiry-days": Option.getOrUndefined(input["expiry-days"]),
    "expiryDays": Option.getOrUndefined(input["expiry-days"]),
    "directory": Option.getOrUndefined(input["directory"]),
  }
  await MobilePairCommand.handler(args)
})
