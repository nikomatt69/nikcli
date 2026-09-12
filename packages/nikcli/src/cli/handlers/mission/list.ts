import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { bootstrap } from "@/cli/bootstrap"
import * as Manager from "@/mission/manager"
import * as Orchestrator from "@/mission/orchestrator"
import {
  progressOf,
} from "@/mission/schema"
import { formatDate, formatStatus } from "./shared"

export default Runtime.handler(Commands.commands["mission"].commands["list"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "format": input["format"],
  }
  await bootstrap(process.cwd(), async (instance) => {
    const missions = await Manager.list(instance.project.id)
    if (args.format === "json") {
      const decorated = missions.map((m) => ({
        ...m,
        runtime: Orchestrator.getRuntime(m.id),
      }))
      console.log(JSON.stringify(decorated, null, 2))
      return
    }
    if (!missions.length) {
      console.log("No missions found. Create one with: nikcli mission new")
      return
    }
    const idW = Math.max(10, ...missions.map((m) => m.id.length))
    const nameW = Math.max(10, ...missions.map((m) => m.name.length))
    const header = `${"ID".padEnd(idW)}  ${"Name".padEnd(nameW)}  Status                Progress       Created`
    console.log(header)
    console.log("─".repeat(header.length))
    for (const m of missions) {
      const rt = Orchestrator.getRuntime(m.id)
      const prog = progressOf(m)
      const progress = `${prog.doneFeatures}/${prog.totalFeatures} feat · ${prog.doneMilestones}/${prog.totalMilestones} ms`
      console.log(
        `${m.id.padEnd(idW)}  ${m.name.padEnd(nameW)}  ${formatStatus(m, rt).padEnd(21)}  ${progress.padEnd(14)}  ${formatDate(m.createdAt)}`,
      )
    }
  })
})
