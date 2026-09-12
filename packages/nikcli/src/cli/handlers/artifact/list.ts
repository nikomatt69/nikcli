import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["artifact"].commands["list"], (input) =>
  delegate(() => import("@/cli/cmd/artifact"), "ArtifactCommand", ["list"] as string[], {
    "session-id": Option.getOrUndefined(input["session-id"]),
  }),
)
