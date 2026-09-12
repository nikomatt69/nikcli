import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mcp"].commands["add"], async (input) => {
  const { McpAddCommand } = await import("@/cli/cmd/mcp")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await McpAddCommand.handler(args)
})
