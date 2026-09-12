import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mcp"].commands["list"], (input) =>
  delegate(() => import("@/cli/cmd/mcp"), "McpCommand", ["list"] as string[], {
  }),
)
