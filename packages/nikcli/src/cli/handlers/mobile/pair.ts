import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { MobileAuth } from "@/mobile/auth"
import { normalizePublicUrl } from "@nikcli-ai/util/mobile-pairing"
import { printPairing } from "./shared"

export default Runtime.handler(Commands.commands["mobile"].commands["pair"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "public-url": input["public-url"],
    publicUrl: input["public-url"],
    name: input["name"],
    "expiry-days": Option.getOrUndefined(input["expiry-days"]),
    expiryDays: Option.getOrUndefined(input["expiry-days"]),
    directory: Option.getOrUndefined(input["directory"]),
  }
  const created = await MobileAuth.create({
    name: String(args.name || "iphone"),
    expiresInDays: args.expiryDays ? Number(args.expiryDays) : undefined,
  })
  const serverUrl = normalizePublicUrl(String(args.publicUrl))
  if (!serverUrl) throw new Error("Invalid --public-url")
  const qr = await printPairing({
    serverUrl,
    token: created.token,
    directory: args.directory ? String(args.directory) : process.cwd(),
  })
  console.log(qr)
})
