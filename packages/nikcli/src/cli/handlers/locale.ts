import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"
import { Config } from "@/config/config"
import { UI } from "@/cli/ui"
import { Global } from "@nikcli-ai/util/global"
import path from "path"
import { resolveLocale, type LocaleConfig } from "@/locale/resolve"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Effect } from "effect"

export function configGet() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    ),
  )
}

/** Parse the --reply-language string flag into the config union. */
export function parseReplyLanguage(value: string | undefined): LocaleConfig["replyLanguage"] | undefined {
  if (value === undefined) return undefined
  const lower = value.trim().toLowerCase()
  if (lower === "true" || lower === "on" || lower === "yes") return true
  if (lower === "false" || lower === "off" || lower === "no") return false
  return value.trim()
}

export function printResolved(cfg: LocaleConfig | undefined) {
  const r = resolveLocale(cfg)
  const reply = r.replyLanguage ? `${r.languageName} (${r.replyLanguage})` : "off (English / not steered)"
  UI.println("")
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "Resolved locale" + UI.Style.TEXT_NORMAL)
  UI.println(`  locale:         ${r.locale}`)
  UI.println(`  language:       ${r.languageName} (${r.language})`)
  UI.println(`  region:         ${r.region}`)
  UI.println(`  timezone:       ${r.timezone}`)
  UI.println(`  currency:       ${r.currency}`)
  UI.println(`  reply language: ${reply}`)
  UI.println(`  source:         ${r.source}`)
  if (r.source === "override") {
    UI.println("")
    UI.println(
      UI.Style.TEXT_DIM +
        "  (from NIKCLI_LOCALE / NIKCLI_LANGUAGE / NIKCLI_REGION — this run only)" +
        UI.Style.TEXT_NORMAL,
    )
  }
}

export async function saveLocale(locale: LocaleConfig | undefined, globalFlag: boolean) {
  const configPath = globalFlag ? path.join(Global.Path.config, "nikcli.json") : path.join(process.cwd(), "nikcli.json")

  const current = await Bun.file(configPath)
    .text()
    .catch(() => "{}")
  const parsed = JSON.parse(current || "{}")

  if (locale === undefined) delete parsed.locale
  else parsed.locale = locale

  await Bun.write(configPath, JSON.stringify(parsed, null, 2))
}

export default Runtime.handler(Commands.commands["locale"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    action: input["action"],
    language: Option.getOrUndefined(input["language"]),
    region: Option.getOrUndefined(input["region"]),
    locale: Option.getOrUndefined(input["locale"]),
    timezone: Option.getOrUndefined(input["timezone"]),
    currency: Option.getOrUndefined(input["currency"]),
    "reply-language": Option.getOrUndefined(input["reply-language"]),
    replyLanguage: Option.getOrUndefined(input["reply-language"]),
    "no-auto-detect": Option.getOrUndefined(input["no-auto-detect"]),
    // yargs' boolean negation set `auto-detect: false` when `--no-auto-detect`
    // was passed, and the body reads that key. Effect has no such rule.
    "auto-detect": Option.getOrUndefined(input["no-auto-detect"]) ? false : undefined,
    noAutoDetect: Option.getOrUndefined(input["no-auto-detect"]),
    global: input["global"],
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    const config = await configGet()

    if (args.action === "reset") {
      delete config.locale
      await saveLocale(undefined, args.global)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Locale reset to auto-detect" + UI.Style.TEXT_NORMAL)
      printResolved(undefined)
      return
    }

    if (args.action === "set") {
      const next: LocaleConfig = { ...config.locale }
      if (args.language !== undefined) next.language = args.language
      if (args.region !== undefined) next.region = args.region
      if (args.locale !== undefined) next.locale = args.locale
      if (args.timezone !== undefined) next.timezone = args.timezone
      if (args.currency !== undefined) next.currency = args.currency
      // SAFETY: the builder declares `reply-language` as a string option, so
      // yargs yields a string or leaves it absent; `parseReplyLanguage`
      // validates the value itself.
      const reply = parseReplyLanguage(args["reply-language"] as string | undefined)
      if (reply !== undefined) next.replyLanguage = reply
      if (args["auto-detect"] === false) next.autoDetect = false

      await saveLocale(next, args.global)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Locale updated" + UI.Style.TEXT_NORMAL)
      printResolved(next)
      return
    }

    // show
    printResolved(config.locale)
  })
})
