import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mobile"].commands["serve"], async (input) => {
  const { MobileServeCommand } = await import("@/cli/cmd/mobile")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "port": input["port"],
    "hostname": input["hostname"],
    "mdns": input["mdns"],
    "cors": input["cors"],
    "public-url": Option.getOrUndefined(input["public-url"]),
    "publicUrl": Option.getOrUndefined(input["public-url"]),
    "pair": input["pair"],
    "pair-name": input["pair-name"],
    "pairName": input["pair-name"],
    "pair-expiry-days": Option.getOrUndefined(input["pair-expiry-days"]),
    "pairExpiryDays": Option.getOrUndefined(input["pair-expiry-days"]),
  }
  await MobileServeCommand.handler(args)
})
