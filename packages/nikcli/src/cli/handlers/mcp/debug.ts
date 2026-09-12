import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mcp"].commands["debug"], async (input) => {
  const { McpDebugCommand } = await import("@/cli/cmd/mcp")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": input["name"],
  }
  await McpDebugCommand.handler(args)
})
