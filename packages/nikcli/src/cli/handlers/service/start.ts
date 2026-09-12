import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["start"], async (input) => {
  const { StartCommand } = await import("@/cli/cmd/service")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await StartCommand.handler(args)
})
