import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["routine"].commands["create"], async (input) => {
  const { RoutineCreateCommand } = await import("@/cli/cmd/routine")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
    "prompt": Option.getOrUndefined(input["prompt"]),
    "cron": Option.getOrUndefined(input["cron"]),
    "api": Option.getOrUndefined(input["api"]),
    "api-token": Option.getOrUndefined(input["api-token"]),
    "apiToken": Option.getOrUndefined(input["api-token"]),
  }
  await RoutineCreateCommand.handler(args)
})
