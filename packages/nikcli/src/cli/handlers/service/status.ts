import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["service"].commands["status"], (input) =>
  delegate(() => import("@/cli/cmd/service"), "ServiceCommand", ["status"] as string[], {
    "json": input["json"],
  }),
)
