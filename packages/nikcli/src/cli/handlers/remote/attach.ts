import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { withInstanceAsync } from "@/effect"
import { UI } from "@/cli/ui"
import { ensureRemoteService } from "./shared"

export default Runtime.handler(Commands.commands["remote"].commands["attach"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    sessionId: input["sessionId"],
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      await ensureRemoteService()
      UI.println(`Attaching to session ${args.sessionId}...`)
      UI.println("This feature is not yet implemented.")
    }
  })
})
