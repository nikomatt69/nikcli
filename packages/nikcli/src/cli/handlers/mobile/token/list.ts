import { Runtime } from "../../../framework/runtime"
import { Commands } from "../../../commands"
import { MobileAuth } from "@/mobile/auth"

export default Runtime.handler(Commands.commands["mobile"].commands["token"].commands["list"], async (_input) => {
  
  const tokens = await MobileAuth.list()
  if (!tokens.length) {
    console.log("No mobile tokens found")
    return
  }
  for (const token of tokens) {
    console.log(`${token.id}  ${token.name}  created=${new Date(token.createdAt).toISOString()}`)
  }
})
