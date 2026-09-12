import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["new"], async (input) => {
  const { MissionNewCommand } = await import("@/cli/cmd/mission")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
    "brief": Option.getOrUndefined(input["brief"]),
    "file": Option.getOrUndefined(input["file"]),
    "from-description": Option.getOrUndefined(input["from-description"]),
    "fromDescription": Option.getOrUndefined(input["from-description"]),
    "model": Option.getOrUndefined(input["model"]),
    "agent": Option.getOrUndefined(input["agent"]),
    "worker-model": Option.getOrUndefined(input["worker-model"]),
    "workerModel": Option.getOrUndefined(input["worker-model"]),
    "start": Option.getOrUndefined(input["start"]),
  }
  await MissionNewCommand.handler(args)
})
