import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["auth"].commands["logout"], (input) =>
  delegate(() => import("@/cli/cmd/auth"), "AuthCommand", ["logout"] as string[], {
  }),
)
