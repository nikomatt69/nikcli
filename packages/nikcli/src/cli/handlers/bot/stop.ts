import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { withInstanceAsync } from "@/effect"
import { getChatBot } from "./shared"

export default Runtime.handler(Commands.commands["bot"].commands["stop"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    name: Option.getOrUndefined(input["name"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Stop Chat Bot")

      const ChatBot = await getChatBot()
      const runningBots = Array.from(ChatBot.getAllBots().keys())

      if (runningBots.length === 0) {
        prompts.log.warn("No running bots")
        prompts.outro("Done")
        return
      }

      let botName = args.name
      if (!botName) {
        const selected = await prompts.select({
          message: "Select bot to stop",
          options: runningBots.map((name) => ({
            label: name,
            value: name,
          })),
        })
        if (prompts.isCancel(selected)) throw new UI.CancelledError()
        botName = selected
      }

      const removed = ChatBot.removeBot(botName)
      if (removed) {
        prompts.log.success(`Bot "${botName}" stopped`)
      } else {
        prompts.log.error(`Bot "${botName}" not found`)
      }

      prompts.outro("Done")
    }
  })
})
