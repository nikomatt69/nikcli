import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { withInstanceAsync } from "@/effect"
import { UI } from "@/cli/ui"
import { remoteService } from "@nikcli-ai/util/remote-tunnel"
import { ensureRemoteService } from "./shared"

export default Runtime.handler(Commands.commands["remote"].commands["stop"], async (_input) => {
  
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    try {
      await ensureRemoteService()
      if (!remoteService.hasActiveSession()) {
        UI.println("No active remote session")
        return
      }

      await remoteService.stopSession()
      UI.println("Remote session stopped")
    } catch (error: any) {
      UI.error(`Failed to stop session: ${error?.message ?? error}`)
    }
  })
})
