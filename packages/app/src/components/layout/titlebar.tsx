import { useNavigate } from "@solidjs/router"
import { useI18n } from "../../i18n"
import { useLayout, useSession, useServer, useAuth } from "../../context"

export default function TitleBar() {
  const { t } = useI18n()
  const { toggleSidebar, state } = useLayout()
  const { activeSession } = useSession()
  const { status } = useServer()
  const { user, isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div class="h-12 border-b flex items-center justify-between px-4 bg-white dark:bg-gray-900">
      <div class="flex items-center gap-4">
        {!state().sidebarOpen && (
          <button onClick={toggleSidebar} class="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
            ☰
          </button>
        )}
        <span class="font-semibold">{activeSession() ? activeSession()?.title : "NikCLI"}</span>
      </div>

      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2 text-sm">
          <span class={`w-2 h-2 rounded-full ${status().connected ? "bg-green-500" : "bg-red-500"}`} />
          <span class="text-gray-600 dark:text-gray-400">
            {status().connected ? t("status.connected") : t("status.disconnected")}
          </span>
        </div>

        {isAuthenticated() ? (
          <div class="flex items-center gap-2">
            <span class="text-sm">{user()?.name}</span>
            <button onClick={logout} class="text-sm text-red-500 hover:text-red-700">
              {t("auth.logout")}
            </button>
          </div>
        ) : (
          <button
            class="text-sm text-blue-600 hover:text-blue-800"
            onClick={() => {
              navigate("/settings")
            }}
          >
            {t("auth.login")}
          </button>
        )}
      </div>
    </div>
  )
}
