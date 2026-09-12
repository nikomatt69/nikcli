import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mobile"].commands["serve"], (input) =>
  delegate(() => import("@/cli/cmd/mobile"), "MobileCommand", ["serve"] as string[], {
    "port": input["port"],
    "hostname": input["hostname"],
    "mdns": input["mdns"],
    "cors": input["cors"],
    "public-url": Option.getOrUndefined(input["public-url"]),
    "pair": input["pair"],
    "pair-name": input["pair-name"],
    "pair-expiry-days": Option.getOrUndefined(input["pair-expiry-days"]),
  }),
)
