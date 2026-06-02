/**
 * Pure, dependency-free locale resolution.
 *
 * Designed for minimal footprint: the system signals (env + Intl) are detected
 * once and frozen in a module singleton — the only "expensive" work, and it is
 * sub-millisecond. Config overrides are merged on top per call (a cheap object
 * merge), so callers never pay the detection cost twice and nothing touches the
 * network. This is the offline, always-available core of the localization story;
 * opt-in network GeoIP enrichment is a separate, lazily-imported concern.
 *
 * Resolution priority (first non-empty wins, per axis):
 *   1. config.locale.* (explicit user override)
 *   2. env: LC_ALL > LC_MESSAGES > LANG > LANGUAGE
 *   3. Intl.DateTimeFormat().resolvedOptions() (system locale + timezone)
 *   4. fallback en-US / US / UTC
 */

import { currencyForRegion } from "./region-currency"

export interface LocaleConfig {
  language?: string
  region?: string
  locale?: string
  timezone?: string
  currency?: string
  autoDetect?: boolean
  replyLanguage?: boolean | string
}

export interface ResolvedLocale {
  /** BCP-47 primary subtag, lowercase, e.g. "it" */
  language: string
  /** ISO-3166 country code, uppercase, e.g. "IT" */
  region: string
  /** Full BCP-47 tag, e.g. "it-IT" */
  locale: string
  /** IANA timezone, e.g. "Europe/Rome" */
  timezone: string
  /** ISO-4217 currency code, e.g. "EUR" */
  currency: string
  /** English display name of the reply language, e.g. "Italian" — for the LLM prompt */
  languageName: string
  /** Resolved reply language tag, or null when the model should not be steered */
  replyLanguage: string | null
  /** Where the language/region was resolved from */
  source: "override" | "config" | "env" | "intl" | "fallback"
}

interface SystemSignals {
  language?: string
  region?: string
  locale?: string
  timezone?: string
  source: "env" | "intl" | "fallback"
}

let signalsCache: SystemSignals | null = null
let displayNames: Intl.DisplayNames | null = null

/** Parse a POSIX/BCP-47 locale string like "it_IT.UTF-8", "it-IT", "C", "POSIX". */
function parseLocaleString(value: string): { language?: string; region?: string } {
  const cleaned = value.split(".")[0]?.split("@")[0]?.trim()
  if (!cleaned || cleaned === "C" || cleaned === "POSIX") return {}
  const [lang, region] = cleaned.replace("_", "-").split("-")
  return {
    language: lang ? lang.toLowerCase() : undefined,
    region: region ? region.toUpperCase() : undefined,
  }
}

function detectSystemSignals(): SystemSignals {
  // env first — LANGUAGE may be a colon-separated priority list ("it:en")
  const envRaw = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE || ""
  const fromEnv = parseLocaleString(envRaw.split(":")[0] ?? "")
  let timezone = process.env.TZ || undefined

  // Intl as enrichment / fallback
  let intlLocale: string | undefined
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions()
    intlLocale = opts.locale
    timezone = timezone || opts.timeZone
  } catch {
    // Intl unavailable in some constrained runtimes — degrade gracefully
  }

  const intlParsed = intlLocale ? parseLocaleString(intlLocale) : {}

  const language = fromEnv.language || intlParsed.language
  const region = fromEnv.region || intlParsed.region

  if (!language && !region) {
    return { timezone, source: "fallback" }
  }

  const locale = language && region ? `${language}-${region}` : intlLocale
  return {
    language,
    region,
    locale,
    timezone,
    source: fromEnv.language ? "env" : "intl",
  }
}

function getSignals(): SystemSignals {
  if (!signalsCache) signalsCache = Object.freeze(detectSystemSignals())
  return signalsCache
}

/** English name of a language tag, via Intl (no static table). Cached. */
function languageNameOf(language: string): string {
  try {
    if (!displayNames) displayNames = new Intl.DisplayNames(["en"], { type: "language" })
    return displayNames.of(language) || language
  } catch {
    return language
  }
}

export function resolveLocale(cfg?: LocaleConfig): ResolvedLocale {
  const autoDetect = cfg?.autoDetect !== false
  const signals: SystemSignals = autoDetect ? getSignals() : { source: "fallback" }

  // Per-invocation override via env (read fresh, never cached) — the equivalent
  // of a `--locale` flag, usable in both the CLI and the TUI. Highest priority,
  // above persisted config: `NIKCLI_LOCALE=ja nikcli ...`.
  const ovRaw = process.env.NIKCLI_LOCALE || ""
  const ovParsed = ovRaw ? parseLocaleString(ovRaw) : {}
  const override = {
    language: process.env.NIKCLI_LANGUAGE || ovParsed.language,
    region: process.env.NIKCLI_REGION || ovParsed.region,
    locale: ovRaw || undefined,
  }

  // A full locale tag (override or config) overrides language + region together
  const cfgParsed = cfg?.locale ? parseLocaleString(cfg.locale) : {}

  const language = (
    override.language ||
    cfg?.language ||
    cfgParsed.language ||
    signals.language ||
    "en"
  ).toLowerCase()
  const region = (override.region || cfg?.region || cfgParsed.region || signals.region || "US").toUpperCase()
  const locale = override.locale || cfg?.locale || `${language}-${region}`
  const timezone = cfg?.timezone || signals.timezone || "UTC"
  const currency = cfg?.currency || currencyForRegion(region) || "USD"

  const hasOverride = !!(override.language || override.region || override.locale)
  const source: ResolvedLocale["source"] = hasOverride
    ? "override"
    : cfg?.language || cfg?.region || cfg?.locale
      ? "config"
      : signals.source

  // Reply language: explicit string wins; true => detected language;
  // false => off; undefined => default on for non-English (the most useful
  // default — English users get no extra prompt, others get localized replies).
  let replyLanguage: string | null
  if (typeof cfg?.replyLanguage === "string") replyLanguage = cfg.replyLanguage.toLowerCase()
  else if (cfg?.replyLanguage === true) replyLanguage = language
  else if (cfg?.replyLanguage === false) replyLanguage = null
  else replyLanguage = language !== "en" ? language : null

  return {
    language,
    region,
    locale,
    timezone,
    currency,
    languageName: languageNameOf(replyLanguage || language),
    replyLanguage,
    source,
  }
}

/** Test seam: clear the memoized system signals so env/Intl can be re-detected. */
export function __resetLocaleCache(): void {
  signalsCache = null
  displayNames = null
}
