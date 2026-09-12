import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["artifact"].commands["logout"], (input) =>
  delegate(() => import("@/cli/cmd/artifact"), "ArtifactCommand", ["logout"] as string[], {
  }),
)
