import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["quickstart"], async (input) => {
  const { QuickstartCommand } = await import("@/cli/cmd/quickstart")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "skip-checks": Option.getOrUndefined(input["skip-checks"]),
    "skipChecks": Option.getOrUndefined(input["skip-checks"]),
    "dry-run": Option.getOrUndefined(input["dry-run"]),
    "dryRun": Option.getOrUndefined(input["dry-run"]),
  }
  await QuickstartCommand.handler(args)
})
