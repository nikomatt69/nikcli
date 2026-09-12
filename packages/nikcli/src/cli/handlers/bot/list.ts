import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["bot"].commands["list"], (input) =>
  delegate(() => import("@/cli/cmd/chatbot"), "BotCommand", ["list"] as string[], {
  }),
)
