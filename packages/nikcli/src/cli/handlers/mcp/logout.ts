import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mcp"].commands["logout"], (input) =>
  delegate(() => import("@/cli/cmd/mcp"), "McpCommand", ["logout"] as string[], {
    "name": Option.getOrUndefined(input["name"]),
  }),
)
