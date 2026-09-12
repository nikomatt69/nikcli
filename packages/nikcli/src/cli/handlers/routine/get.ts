import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { bootstrap } from "@/cli/bootstrap"
import { Routine } from "@/mobile/routine"
import { formatDate, formatTriggers } from "./shared"

export default Runtime.handler(Commands.commands["routine"].commands["get"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    id: input["id"],
    format: input["format"],
  }
  await bootstrap(process.cwd(), async (instance) => {
    const routine = await Routine.get(instance, String(args.id))
    if (!routine) throw new Error(`Routine "${args.id}" not found.`)

    if (args.format === "json") {
      console.log(JSON.stringify(routine, null, 2))
      return
    }

    console.log(`ID:         ${routine.id}`)
    console.log(`Name:       ${routine.name}`)
    console.log(`Status:     ${routine.paused ? "paused" : "active"}`)
    console.log(`Created:    ${formatDate(routine.createdAt)}`)
    console.log(`Updated:    ${formatDate(routine.updatedAt)}`)
    if (routine.lastRunAt) console.log(`Last run:   ${formatDate(routine.lastRunAt)}`)
    if (routine.lastSessionID) console.log(`Last session: ${routine.lastSessionID}`)
    console.log(`Triggers:   ${formatTriggers(routine.triggers)}`)
    console.log(`\nPrompt:\n${routine.prompt}`)
  })
})
