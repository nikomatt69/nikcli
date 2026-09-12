import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["bot"].commands["add"], (input) =>
  delegate(() => import("@/cli/cmd/chatbot"), "BotCommand", ["add"] as string[], {
  }),
)
