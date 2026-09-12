import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["cancel"], async (input) => {
  const { MissionCancelCommand } = await import("@/cli/cmd/mission")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": input["id"],
  }
  await MissionCancelCommand.handler(args)
})
