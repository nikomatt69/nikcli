import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mcp"].commands["list"], async (input) => {
  const { McpListCommand } = await import("@/cli/cmd/mcp")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await McpListCommand.handler(args)
})
