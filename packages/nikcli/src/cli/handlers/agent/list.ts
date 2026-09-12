import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["agent"].commands["list"], async (input) => {
  const { AgentListCommand } = await import("@/cli/cmd/agent")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await AgentListCommand.handler(args)
})
