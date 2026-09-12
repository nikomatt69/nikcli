import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["start"], async (input) => {
  const { MissionStartCommand } = await import("@/cli/cmd/mission")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": input["id"],
    "tail": Option.getOrUndefined(input["tail"]),
  }
  await MissionStartCommand.handler(args)
})
