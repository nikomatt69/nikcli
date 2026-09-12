import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["agent"].commands["list"], (input) =>
  delegate(() => import("@/cli/cmd/agent"), "AgentCommand", ["list"] as string[], {
  }),
)
