import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { bootstrap } from "@/cli/bootstrap"
import { Routine } from "@/mobile/routine"

export default Runtime.handler(Commands.commands["routine"].commands["run"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": input["id"],
    "text": Option.getOrUndefined(input["text"]),
  }
  await bootstrap(process.cwd(), async (instance) => {
    const spinner = prompts.spinner()
    spinner.start("Running routine…")
    try {
      const session = await Routine.run(instance, String(args.id), { text: args.text })
      spinner.stop(`Session created: ${session.id}`)
      console.log(`Monitor with: nikcli session list`)
    } catch (error) {
      spinner.stop("Failed")
      throw error
    }
  })
})
