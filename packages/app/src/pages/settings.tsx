import { useI18n } from "../i18n"
import { useSettings } from "../context"

export default function Settings() {
  const { t } = useI18n()
  const { settings, updateSetting } = useSettings()

  // Set title manually
  if (typeof document !== "undefined") {
    document.title = "Settings | NikCLI"
  }

  return (
    <div class="max-w-2xl mx-auto p-8 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen">
      <h1 class="text-3xl font-bold mb-8">{t("settings.title")}</h1>

      <section class="mb-8">
        <h2 class="text-xl font-semibold mb-4">{t("settings.appearance")}</h2>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label>{t("settings.theme")}</label>
            <select
              value={settings().theme}
              onChange={(e) => updateSetting("theme", e.currentTarget.value as any)}
              class="border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
            >
              <option value="light">{t("settings.light")}</option>
              <option value="dark">{t("settings.dark")}</option>
              <option value="system">{t("settings.system")}</option>
            </select>
          </div>
          <div class="flex items-center justify-between">
            <label>{t("settings.fontSize")}</label>
            <input
              type="number"
              value={settings().fontSize}
              onChange={(e) => updateSetting("fontSize", parseInt(e.currentTarget.value))}
              class="border rounded px-3 py-2 w-24 dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
        </div>
      </section>

      <section class="mb-8">
        <h2 class="text-xl font-semibold mb-4">{t("settings.editor")}</h2>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label>{t("settings.wordWrap")}</label>
            <input
              type="checkbox"
              checked={settings().wordWrap}
              onChange={(e) => updateSetting("wordWrap", e.currentTarget.checked)}
            />
          </div>
          <div class="flex items-center justify-between">
            <label>{t("settings.showLineNumbers")}</label>
            <input
              type="checkbox"
              checked={settings().showLineNumbers}
              onChange={(e) => updateSetting("showLineNumbers", e.currentTarget.checked)}
            />
          </div>
        </div>
      </section>

      <a href="/" class="text-blue-600 hover:underline">
        ← Back to Home
      </a>
    </div>
  )
}
