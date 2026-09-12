import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { withInstanceAsync } from "@/effect"
import { ensureRemoteService, shareSession } from "./shared"

export default Runtime.handler(Commands.commands["remote"].commands["share"], async (_input) => {
  
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      await ensureRemoteService()
      await shareSession()
    }
  })
})
