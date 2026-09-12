import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["file"].commands["search"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["file","search"] as string[], {
    "query": input["query"],
  }),
)
