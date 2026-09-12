import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["bot"].commands["add"], async (input) => {
  const { BotAddCommand } = await import("@/cli/cmd/chatbot")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await BotAddCommand.handler(args)
})
