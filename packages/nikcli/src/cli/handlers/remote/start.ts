import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["remote"].commands["start"], async (input) => {
  const { RemoteStartCommand } = await import("@/cli/cmd/remote")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "port": input["port"],
    "hostname": input["hostname"],
    "mdns": input["mdns"],
    "cors": input["cors"],
    "name": Option.getOrUndefined(input["name"]),
    "timeout": input["timeout"],
    "no-tunnel": input["no-tunnel"],
    "noTunnel": input["no-tunnel"],
    "provider": Option.getOrUndefined(input["provider"]),
    "cloud": input["cloud"],
    "cloud-url": Option.getOrUndefined(input["cloud-url"]),
    "cloudUrl": Option.getOrUndefined(input["cloud-url"]),
    "cloud-token": Option.getOrUndefined(input["cloud-token"]),
    "cloudToken": Option.getOrUndefined(input["cloud-token"]),
    "cloud-device-id": Option.getOrUndefined(input["cloud-device-id"]),
    "cloudDeviceId": Option.getOrUndefined(input["cloud-device-id"]),
    "cloud-session-id": Option.getOrUndefined(input["cloud-session-id"]),
    "cloudSessionId": Option.getOrUndefined(input["cloud-session-id"]),
    "cloud-public-key": Option.getOrUndefined(input["cloud-public-key"]),
    "cloudPublicKey": Option.getOrUndefined(input["cloud-public-key"]),
    "mobile": input["mobile"],
    "mobile-only": input["mobile-only"],
    "mobileOnly": input["mobile-only"],
    "public-url": Option.getOrUndefined(input["public-url"]),
    "publicUrl": Option.getOrUndefined(input["public-url"]),
    "pair": input["pair"],
    "pair-name": input["pair-name"],
    "pairName": input["pair-name"],
    "pair-expiry-days": Option.getOrUndefined(input["pair-expiry-days"]),
    "pairExpiryDays": Option.getOrUndefined(input["pair-expiry-days"]),
  }
  await RemoteStartCommand.handler(args)
})
