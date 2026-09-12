import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["sync"].commands["token"].commands["create"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    name: input["name"],
    "expiry-days": Option.getOrUndefined(input["expiry-days"]),
    expiryDays: Option.getOrUndefined(input["expiry-days"]),
  }
  const { MobileAuth } = await import("@/mobile/auth")
  const created = await MobileAuth.create({
    name: String(args.name || "cli-sync"),
    expiresInDays: args.expiryDays ? Number(args.expiryDays) : undefined,
    scope: "cli-sync",
  })
  console.log(`token id: ${created.info.id} (scope: cli-sync)`)
  console.log(`NIKCLI_REMOTE_TOKEN=${created.token}`)
  console.log("store the token now — it cannot be shown again")
})
