import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["heap"], (input) =>
  delegate(() => import("@/cli/cmd/heap"), "HeapCommand", [] as string[], {
    "detailed": Option.getOrUndefined(input["detailed"]),
  }),
)
