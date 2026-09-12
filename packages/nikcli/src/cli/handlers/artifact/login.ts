import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["artifact"].commands["login"], (input) =>
  delegate(() => import("@/cli/cmd/artifact"), "ArtifactCommand", ["login"] as string[], {
  }),
)
