import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["github"].commands["run"], (input) =>
  delegate(() => import("@/cli/cmd/github"), "GithubCommand", ["run"] as string[], {
    "event": Option.getOrUndefined(input["event"]),
    "token": Option.getOrUndefined(input["token"]),
  }),
)
