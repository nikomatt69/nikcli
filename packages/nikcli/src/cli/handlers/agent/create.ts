import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["agent"].commands["create"], async (input) => {
  const { AgentCreateCommand } = await import("@/cli/cmd/agent")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "path": Option.getOrUndefined(input["path"]),
    "description": Option.getOrUndefined(input["description"]),
    "mode": Option.getOrUndefined(input["mode"]),
    "tools": Option.getOrUndefined(input["tools"]),
    "model": Option.getOrUndefined(input["model"]),
  }
  await AgentCreateCommand.handler(args)
})
