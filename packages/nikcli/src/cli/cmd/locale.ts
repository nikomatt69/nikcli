import type { Argv } from "yargs"
import { Config } from "../../config/config"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "@nikcli-ai/util/global"
import path from "path"
import { resolveLocale, type LocaleConfig } from "../../locale/resolve"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Effect } from "effect"

function configGet() {
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
function parseReplyLanguage(value: string | undefined): LocaleConfig["replyLanguage"] | undefined {
  if (value === undefined) return undefined
  const lower = value.trim().toLowerCase()
  if (lower === "true" || lower === "on" || lower === "yes") return true
  if (lower === "false" || lower === "off" || lower === "no") return false
  return value.trim()
}

export const LocaleCommand = cmd({
  command: "locale [action]",
  describe: "show or set the CLI language, region, and the model's reply language",
  builder: (yargs: Argv) => {
    return yargs
      .positional("action", {
        describe: "show the resolved locale, set overrides, or reset to auto-detect",
        type: "string",
        choices: ["show", "set", "reset"] as const,
        default: "show",
      })
      .option("language", { describe: "language subtag, e.g. it, ja, ar", type: "string" })
      .option("region", { describe: "ISO-3166 country code, e.g. IT, JP", type: "string" })
      .option("locale", { describe: "full BCP-47 tag, e.g. it-IT (overrides language + region)", type: "string" })
      .option("timezone", { describe: "IANA timezone, e.g. Europe/Rome", type: "string" })
      .option("currency", { describe: "ISO-4217 currency code, e.g. EUR", type: "string" })
      .option("reply-language", {
        describe: "model reply language: true | false | <tag> (e.g. fr)",
        type: "string",
      })
      .option("no-auto-detect", { describe: "disable auto-detection from environment", type: "boolean" })
      .option("global", { describe: "edit global config instead of project config", type: "boolean", default: true })
  },
  handler: async (args) => {
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
  },
})

function printResolved(cfg: LocaleConfig | undefined) {
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

async function saveLocale(locale: LocaleConfig | undefined, globalFlag: boolean) {
  const configPath = globalFlag ? path.join(Global.Path.config, "nikcli.json") : path.join(process.cwd(), "nikcli.json")

  const current = await Bun.file(configPath)
    .text()
    .catch(() => "{}")
  const parsed = JSON.parse(current || "{}")

  if (locale === undefined) delete parsed.locale
  else parsed.locale = locale

  await Bun.write(configPath, JSON.stringify(parsed, null, 2))
}
