import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { bootstrap } from "@/cli/bootstrap"
import { UI } from "@/cli/ui"
import * as Manager from "@/mission/manager"

export default Runtime.handler(Commands.commands["mission"].commands["delete"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    id: input["id"],
    yes: Option.getOrUndefined(input["yes"]),
  }
  await bootstrap(process.cwd(), async (instance) => {
    if (!args.yes) {
      UI.error("Refusing to delete without --yes (mission deletion is destructive).")
      process.exit(1)
    }
    const removed = await Manager.remove(instance.project.id, instance.directory, String(args.id))
    console.log(removed ? `Deleted mission ${args.id}` : `Mission ${args.id} not found`)
  })
})
