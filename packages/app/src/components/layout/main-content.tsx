import { useI18n } from "../../i18n"
import { useSession } from "../../context"

export default function MainContent() {
  const { t } = useI18n()
  const { activeSession } = useSession()

  return (
    <div class="flex-1 overflow-auto p-4 bg-white dark:bg-gray-950">
      {activeSession() ? (
        <div class="h-full">
          {/* TODO: Add code editor component */}
          <div class="h-full flex items-center justify-center text-gray-500">{t("session.editorPlaceholder")}</div>
        </div>
      ) : (
        <div class="h-full flex flex-col items-center justify-center text-gray-500">
          <p class="mb-4">{t("session.noActiveSession")}</p>
          <p class="text-sm">{t("session.createNewSession")}</p>
        </div>
      )}
    </div>
  )
}
