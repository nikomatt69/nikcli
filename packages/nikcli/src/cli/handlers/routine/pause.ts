import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { bootstrap } from "@/cli/bootstrap"
import { Routine } from "@/mobile/routine"

export default Runtime.handler(Commands.commands["routine"].commands["pause"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": input["id"],
  }
  await bootstrap(process.cwd(), async (instance) => {
    const routine = await Routine.pause(instance, String(args.id))
    console.log(`Paused: ${routine.id} (${routine.name})`)
  })
})
