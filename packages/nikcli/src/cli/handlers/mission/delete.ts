import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["delete"], async (input) => {
  const { MissionDeleteCommand } = await import("@/cli/cmd/mission")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": input["id"],
    "yes": Option.getOrUndefined(input["yes"]),
  }
  await MissionDeleteCommand.handler(args)
})
