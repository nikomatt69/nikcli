import { createContext, createSignal, useContext, createEffect, type ParentComponent } from "solid-js"
import type { Translations, Language, TranslationKey } from "./types"
import { en } from "./en"
import { it } from "./it"
import { es } from "./es"
import { fr } from "./fr"
import { de } from "./de"

// Language dictionary
const translations: Record<Language, Translations> = {
  en,
  it,
  es,
  fr,
  de,
}

// Supported languages
export const supportedLanguages: Language[] = ["en", "it", "es", "fr", "de"]

// Language display names
export const languageNames: Record<Language, string> = {
  en: "English",
  it: "Italiano",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
}

// Get browser language
function getBrowserLanguage(): Language {
  if (typeof navigator === "undefined") return "en"

  const browserLang = navigator.language?.split("-")[0]?.toLowerCase()

  if (browserLang && supportedLanguages.includes(browserLang as Language)) {
    return browserLang as Language
  }

  return "en"
}

// Get nested value from object using dot notation
function getNestedValue(obj: any, path: string): string | undefined {
  return path.split(".").reduce((current, key) => {
    return current?.[key]
  }, obj)
}

// Context type
interface I18nContextValue {
  language: () => Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey, params?: Record<string, string>) => string
  availableLanguages: Language[]
}

// Create context
const I18nContext = createContext<I18nContextValue>()

// Provider component
export const I18nProvider: ParentComponent = (props) => {
  // Initialize language from localStorage or browser preference
  const getInitialLanguage = (): Language => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("nikcli-language") as Language
      if (saved && supportedLanguages.includes(saved)) {
        return saved
      }
    }
    return getBrowserLanguage()
  }

  const [language, setLanguageSignal] = createSignal<Language>(getInitialLanguage())

  // Persist language change to localStorage
  createEffect(() => {
    const currentLang = language()
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("nikcli-language", currentLang)
    }
  })

  // Set language with validation
  const setLanguage = (lang: Language) => {
    if (supportedLanguages.includes(lang)) {
      setLanguageSignal(() => lang)
    } else {
      console.warn(`[i18n] Unsupported language: ${lang}`)
    }
  }

  // Translation function with optional interpolation
  const t = (key: TranslationKey, params?: Record<string, string>): string => {
    const currentTranslations = translations[language()]
    let value = getNestedValue(currentTranslations, key)

    // Fallback to English if translation not found
    if (value === undefined) {
      console.warn(`[i18n] Missing translation for key: ${key} in language: ${language()}`)
      value = getNestedValue(en, key)
    }

    // Final fallback to the key itself
    if (value === undefined) {
      return key
    }

    // Interpolate parameters if provided
    if (params) {
      return Object.entries(params).reduce(
        (str, [paramKey, paramValue]) => str.replace(new RegExp(`{{${paramKey}}}`, "g"), paramValue),
        value as string,
      )
    }

    return value as string
  }

  const contextValue: I18nContextValue = {
    language,
    setLanguage,
    t,
    availableLanguages: supportedLanguages,
  }

  return <I18nContext.Provider value={contextValue}>{props.children}</I18nContext.Provider>
}

// Fallback translations for when context is not available
const fallbackT = (key: TranslationKey, _params?: Record<string, string>): string => {
  const value = getNestedValue(en, key)
  return value !== undefined ? (value as string) : key
}

// Fallback context value for when I18nProvider is not available
const fallbackContext: I18nContextValue = {
  language: () => "en",
  setLanguage: () => {},
  t: fallbackT,
  availableLanguages: supportedLanguages,
}

// Hook to use i18n
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  return context ?? fallbackContext
}

// Re-export types
export type { Translations, Language, TranslationKey } from "./types"
