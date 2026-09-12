import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["locale"], (input) =>
  delegate(() => import("@/cli/cmd/locale"), "LocaleCommand", [] as string[], {
    "action": input["action"],
    "language": Option.getOrUndefined(input["language"]),
    "region": Option.getOrUndefined(input["region"]),
    "locale": Option.getOrUndefined(input["locale"]),
    "timezone": Option.getOrUndefined(input["timezone"]),
    "currency": Option.getOrUndefined(input["currency"]),
    "reply-language": Option.getOrUndefined(input["reply-language"]),
    "no-auto-detect": Option.getOrUndefined(input["no-auto-detect"]),
    "global": input["global"],
  }),
)
