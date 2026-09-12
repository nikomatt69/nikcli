import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mcp"].commands["logout"], async (input) => {
  const { McpLogoutCommand } = await import("@/cli/cmd/mcp")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
  }
  await McpLogoutCommand.handler(args)
})
