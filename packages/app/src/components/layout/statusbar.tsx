import { useI18n } from "../../i18n"
import { useServer, useSession } from "../../context"

export default function StatusBar() {
  const { t } = useI18n()
  const { status } = useServer()
  const { sessions, activeSession } = useSession()

  return (
    <div class="h-6 border-t bg-gray-100 dark:bg-gray-900 flex items-center px-4 text-xs text-gray-600 dark:text-gray-400">
      <div class="flex items-center gap-4">
        <span>{status().connected ? t("status.connected") : t("status.disconnected")}</span>
        {status().latency > 0 && <span>{status().latency.toFixed(0)}ms</span>}
        <span>|</span>
        <span>
          {t("status.sessions")}: {sessions().length}
        </span>
        {activeSession() && (
          <>
            <span>|</span>
            <span>{activeSession()?.name}</span>
          </>
        )}
      </div>
    </div>
  )
}
