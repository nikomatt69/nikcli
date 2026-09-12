import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { bootstrap } from "@/cli/bootstrap"
import { Routine } from "@/mobile/routine"
import { formatTriggers } from "./shared"

export default Runtime.handler(Commands.commands["routine"].commands["list"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    format: input["format"],
  }
  await bootstrap(process.cwd(), async (instance) => {
    const routines = await Routine.list(instance)

    if (args.format === "json") {
      console.log(JSON.stringify(routines, null, 2))
      return
    }

    if (!routines.length) {
      console.log("No routines found. Create one with: nikcli routine create")
      return
    }

    const idW = Math.max(10, ...routines.map((r) => r.id.length))
    const nameW = Math.max(10, ...routines.map((r) => r.name.length))

    const header = `${"ID".padEnd(idW)}  ${"Name".padEnd(nameW)}  Status    Triggers`
    console.log(header)
    console.log("─".repeat(header.length))
    for (const r of routines) {
      const status = r.paused ? "paused   " : "active   "
      console.log(`${r.id.padEnd(idW)}  ${r.name.padEnd(nameW)}  ${status} ${formatTriggers(r.triggers)}`)
    }
  })
})
