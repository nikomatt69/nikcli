import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["locale"], async (input) => {
  const { LocaleCommand } = await import("@/cli/cmd/locale")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "action": input["action"],
    "language": Option.getOrUndefined(input["language"]),
    "region": Option.getOrUndefined(input["region"]),
    "locale": Option.getOrUndefined(input["locale"]),
    "timezone": Option.getOrUndefined(input["timezone"]),
    "currency": Option.getOrUndefined(input["currency"]),
    "reply-language": Option.getOrUndefined(input["reply-language"]),
    "replyLanguage": Option.getOrUndefined(input["reply-language"]),
    "no-auto-detect": Option.getOrUndefined(input["no-auto-detect"]),
    "noAutoDetect": Option.getOrUndefined(input["no-auto-detect"]),
    "global": input["global"],
  }
  await LocaleCommand.handler(args)
})
