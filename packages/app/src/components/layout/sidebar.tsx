import { For } from "solid-js"
import { useI18n } from "../../i18n"
import { useSession, useLayout } from "../../context"

export default function Sidebar() {
  const { t } = useI18n()
  const { sessions, activeSession, createSession, closeSession, activateSession } = useSession()
  const { toggleSidebar } = useLayout()

  return (
    <div class="w-72 border-r bg-gray-50 dark:bg-gray-900 flex flex-col">
      <div class="p-4 border-b flex items-center justify-between">
        <h2 class="font-semibold">{t("sidebar.sessions")}</h2>
        <button onClick={toggleSidebar} class="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded">
          ←
        </button>
      </div>

      <div class="flex-1 overflow-auto p-2">
        {sessions().length === 0 ? (
          <p class="text-gray-500 text-sm p-4">{t("sidebar.noSessions")}</p>
        ) : (
          <div class="space-y-1">
            <For each={sessions()}>
              {(session) => (
                <div
                  onClick={() => activateSession(session.id)}
                  class={`p-2 rounded cursor-pointer flex items-center justify-between ${
                    activeSession()?.id === session.id
                      ? "bg-blue-100 dark:bg-blue-900"
                      : "hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  <span class="truncate">{session.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void closeSession(session.id)
                    }}
                    class="text-red-500 hover:text-red-700"
                  >
                    ×
                  </button>
                </div>
              )}
            </For>
          </div>
        )}
      </div>

      <div class="p-4 border-t">
        <button
          onClick={() => {
            void createSession()
          }}
          class="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
        >
          {t("sidebar.newSession")}
        </button>
      </div>
    </div>
  )
}
