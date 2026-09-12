import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { bootstrap } from "@/cli/bootstrap"
import { UI } from "@/cli/ui"
import * as Manager from "@/mission/manager"
import * as Orchestrator from "@/mission/orchestrator"

export default Runtime.handler(Commands.commands["mission"].commands["resume"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    id: input["id"],
  }
  await bootstrap(process.cwd(), async (instance) => {
    const mission = await Manager.get(instance.project.id, String(args.id))
    if (!mission) {
      UI.error(`Mission "${args.id}" not found`)
      process.exit(1)
    }
    void Orchestrator.start(mission.id)
    console.log(`Resuming: ${mission.id} (${mission.name})`)
  })
})
