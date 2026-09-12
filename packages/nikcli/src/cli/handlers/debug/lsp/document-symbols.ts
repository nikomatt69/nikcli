import { Runtime } from "../../../framework/runtime"
import { delegate } from "../../../framework/yargs-bridge"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["lsp"].commands["document-symbols"], (input) =>
  delegate(() => import("@/cli/cmd/debug"), "DebugCommand", ["lsp","document-symbols"] as string[], {
    "uri": input["uri"],
  }),
)
