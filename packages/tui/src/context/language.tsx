/**
 * TUI internationalization context.
 *
 * Implements `specs/opencode-parity/06-tui-i18n.md`. Provides `t(key, params?)` for string
 * translation and `locale()` for locale-sensitive formatting. The locale is resolved once from
 * the environment (default English); missing keys fall back to English, then to the key itself.
 */
import { createSimpleContext } from "./helper"
import { en, type TuiMessageKey } from "../i18n/en"
import { zh } from "../i18n/zh"
import { es } from "../i18n/es"
import { fr } from "../i18n/fr"
import { de } from "../i18n/de"
import { it } from "../i18n/it"
import { pt } from "../i18n/pt"
import { ja } from "../i18n/ja"
import { ko } from "../i18n/ko"
import { ru } from "../i18n/ru"
import { ar } from "../i18n/ar"
import { hi } from "../i18n/hi"

const DICTS: Record<string, Partial<Record<TuiMessageKey, string>>> = {
  en,
  zh,
  es,
  fr,
  de,
  it,
  pt,
  ja,
  ko,
  ru,
  ar,
  hi,
}
const SUPPORTED = Object.keys(DICTS)

/** Extract the primary language subtag from a POSIX/BCP-47 locale string. */
function primarySubtag(value: string): string {
  return value.split(/[._-]/)[0].toLowerCase()
}

/** Detect the OS locale via Intl — works on macOS even when `LANG` is not exported. */
function detectIntlLocale(): string | undefined {
  try {
    const opts = new Intl.DateTimeFormat().resolvedOptions()
    return opts.locale
  } catch {
    return undefined
  }
}

export function resolveLocale(raw?: string): string {
  // Resolution priority (first non-empty wins):
  //   1. explicit `raw` argument (tests, calls)
  //   2. NIKCLI_LANG / NIKCLI_LOCALE / NIKCLI_LANGUAGE env overrides
  //   3. LC_ALL / LC_MESSAGES / LANG / LANGUAGE (POSIX env)
  //   4. Intl.DateTimeFormat().resolvedOptions().locale (OS fallback)
  //   5. "en"
  const candidates = [
    raw,
    process.env.NIKCLI_LANG,
    process.env.NIKCLI_LOCALE,
    process.env.NIKCLI_LANGUAGE,
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    process.env.LANGUAGE?.split(":")[0],
    detectIntlLocale(),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const base = primarySubtag(candidate)
    if (SUPPORTED.includes(base)) return base
  }
  return "en"
}

export type TranslateParams = Record<string, string | number>

export function translate(locale: string, key: TuiMessageKey, params?: TranslateParams): string {
  const dict = DICTS[locale] ?? en
  let template = dict[key] ?? en[key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      template = template.replaceAll(`{{${name}}}`, String(value))
    }
  }
  return template
}

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  init: () => {
    const locale = resolveLocale()
    return {
      locale: () => locale,
      t: (key: TuiMessageKey, params?: TranslateParams) => translate(locale, key, params),
    }
  },
})
