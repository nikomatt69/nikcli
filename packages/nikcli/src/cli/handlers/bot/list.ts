import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["bot"].commands["list"], async (input) => {
  const { BotListCommand } = await import("@/cli/cmd/chatbot")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await BotListCommand.handler(args)
})
