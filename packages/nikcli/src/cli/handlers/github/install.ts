import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["github"].commands["install"], (input) =>
  delegate(() => import("@/cli/cmd/github"), "GithubCommand", ["install"] as string[], {
  }),
)
