import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { bootstrap } from "@/cli/bootstrap"

export default Runtime.handler(Commands.commands["debug"].commands["wait"], async (_input) => {
  await bootstrap(process.cwd(), async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000 * 60 * 60 * 24))
  })
})
