import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mcp"].commands["debug"], (input) =>
  delegate(() => import("@/cli/cmd/mcp"), "McpCommand", ["debug"] as string[], {
    "name": input["name"],
  }),
)
