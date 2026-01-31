import { createContext, useContext, createSignal, type JSX } from "solid-js"

interface Settings {
  language: string
  theme: "light" | "dark" | "system"
  fontSize: number
  fontFamily: string
  wordWrap: boolean
  tabSize: number
  showLineNumbers: boolean
  enableAI: boolean
  autoSave: boolean
}

interface SettingsContextValue {
  settings: () => Settings
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  resetSettings: () => void
}

const defaultSettings: Settings = {
  language: "en",
  theme: "system",
  fontSize: 14,
  fontFamily: "JetBrains Mono",
  wordWrap: true,
  tabSize: 2,
  showLineNumbers: true,
  enableAI: true,
  autoSave: true,
}

const SettingsContext = createContext<SettingsContextValue>()

export function SettingsProvider(props: { children: JSX.Element }) {
  const [settings, setSettings] = createSignal<Settings>(defaultSettings)

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const resetSettings = () => {
    setSettings(defaultSettings)
  }

  return (
    <SettingsContext.Provider value={{ settings, updateSetting, resetSettings }}>
      {props.children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider")
  }
  return context
}
