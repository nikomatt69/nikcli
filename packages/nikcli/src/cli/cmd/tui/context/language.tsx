/**
 * TUI internationalization context.
 *
 * Provides `t(key, params?)` for string
 * translation and `locale()` for locale-sensitive formatting. The locale is resolved once from
 * the environment (default English); missing keys fall back to English, then to the key itself.
 */
import { createSimpleContext } from "./helper"
import { en, type TuiMessageKey } from "../i18n/en"
import { zh } from "../i18n/zh"

const DICTS: Record<string, Partial<Record<TuiMessageKey, string>>> = { en, zh }
const SUPPORTED = Object.keys(DICTS)

export function resolveLocale(raw?: string): string {
  const value = (raw ?? process.env.NIKCLI_LANG ?? process.env.LC_ALL ?? process.env.LANG ?? "en").toLowerCase()
  const base = value.split(/[._-]/)[0]
  return SUPPORTED.includes(base) ? base : "en"
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
