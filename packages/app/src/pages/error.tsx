import { useI18n } from "../i18n"

export default function Error() {
  const { t } = useI18n()

  // Set title manually
  if (typeof document !== "undefined") {
    document.title = "404 | NikCLI"
  }

  return (
    <div class="flex flex-col items-center justify-center h-full min-h-screen p-8 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <h1 class="text-6xl font-bold mb-4">404</h1>
      <p class="text-xl text-gray-600 dark:text-gray-400 mb-8">{t("error.notFound")}</p>
      <a href="/" class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
        {t("error.goHome")}
      </a>
    </div>
  )
}
