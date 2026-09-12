import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["quickstart"], (input) =>
  delegate(() => import("@/cli/cmd/quickstart"), "QuickstartCommand", [] as string[], {
    "skip-checks": Option.getOrUndefined(input["skip-checks"]),
    "dry-run": Option.getOrUndefined(input["dry-run"]),
  }),
)
