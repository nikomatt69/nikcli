import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["doctor"], async (input) => {
  const { DoctorCommand } = await import("@/cli/cmd/doctor")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "json": Option.getOrUndefined(input["json"]),
  }
  await DoctorCommand.handler(args)
})
