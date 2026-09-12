import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["agent"], async (input) => {
  const { AgentCommand } = await import("@/cli/cmd/debug/agent")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": input["name"],
    "tool": Option.getOrUndefined(input["tool"]),
    "params": Option.getOrUndefined(input["params"]),
  }
  await AgentCommand.handler(args)
})
