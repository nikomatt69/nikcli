import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["scrap"], async (input) => {
  const { ScrapCommand } = await import("@/cli/cmd/debug/scrap")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await ScrapCommand.handler(args)
})
