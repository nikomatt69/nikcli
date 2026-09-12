import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["status"], async (input) => {
  const { StatusCommand } = await import("@/cli/cmd/service")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "json": input["json"],
  }
  await StatusCommand.handler(args)
})
