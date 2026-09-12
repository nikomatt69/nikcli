import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { bootstrap } from "@/cli/bootstrap"
import { Routine } from "@/mobile/routine"

export default Runtime.handler(Commands.commands["routine"].commands["delete"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    id: input["id"],
    yes: Option.getOrUndefined(input["yes"]),
  }
  await bootstrap(process.cwd(), async (instance) => {
    if (!args.yes) {
      const routine = await Routine.get(instance, String(args.id))
      if (!routine) throw new Error(`Routine "${args.id}" not found.`)
      const confirmed = await prompts.confirm({
        message: `Delete routine "${routine.name}" (${routine.id})?`,
        initialValue: false,
      })
      if (prompts.isCancel(confirmed) || !confirmed) {
        console.log("Cancelled.")
        return
      }
    }
    await Routine.remove(instance, String(args.id))
    console.log(`Deleted routine ${args.id}`)
  })
})
