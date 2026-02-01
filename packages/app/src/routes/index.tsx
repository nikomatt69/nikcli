import { A } from "@solidjs/router"
import { useI18n } from "../i18n"
import { useAuth } from "../context"

export default function Home() {
  const { t } = useI18n()
  const { isAuthenticated, user } = useAuth()

  if (typeof document !== "undefined") {
    document.title = "NikCLI"
  }

  return (
    <div class="flex flex-col items-center justify-center h-full min-h-screen p-8 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div class="text-center max-w-2xl">
        <h1 class="text-5xl font-bold mb-6 text-gray-900 dark:text-white">{t("home.welcome")}</h1>
        <p class="text-xl text-gray-600 dark:text-gray-300 mb-10">{t("home.description")}</p>
        <div class="flex gap-4 justify-center">
          <A
            href="/session"
            class="px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-lg hover:shadow-xl"
          >
            {t("home.startSession")}
          </A>
          <A
            href="/settings"
            class="px-8 py-4 border-2 border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            {t("home.settings")}
          </A>
        </div>
        <div class="mt-6 text-sm text-gray-500 dark:text-gray-400">
          {isAuthenticated() ? `${t("auth.connectedAs")} ${user()?.name}` : t("auth.loginHint")}
        </div>
      </div>
      <div class="mt-12 text-sm text-gray-500 dark:text-gray-400">Built with SolidJS & TailwindCSS</div>
    </div>
  )
}
