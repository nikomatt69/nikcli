import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"
import { MobileAuth } from "@/mobile/auth"

export default Runtime.handler(Commands.commands["mobile"].commands["token"].commands["revoke"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": input["id"],
  }
  const ok = await MobileAuth.remove(String(args.id))
  if (!ok) throw new Error(`Token not found: ${args.id}`)
  console.log(`Revoked mobile token ${args.id}`)
})
