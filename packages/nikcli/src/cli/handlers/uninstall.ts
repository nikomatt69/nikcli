import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["uninstall"], async (input) => {
  const { UninstallCommand } = await import("@/cli/cmd/uninstall")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "keep-config": input["keep-config"],
    "keepConfig": input["keep-config"],
    "keep-data": input["keep-data"],
    "keepData": input["keep-data"],
    "dry-run": input["dry-run"],
    "dryRun": input["dry-run"],
    "force": input["force"],
  }
  await UninstallCommand.handler(args)
})
