import { useI18n } from "../i18n"
import { useLayout } from "../context"
import TitleBar from "../components/layout/titlebar"
import Sidebar from "../components/layout/sidebar"
import MainContent from "../components/layout/main-content"
import StatusBar from "../components/layout/statusbar"
import PromptInput from "../components/input/prompt-input"

export default function Session() {
  const { t } = useI18n()
  const { state } = useLayout()

  // Set title manually
  if (typeof document !== "undefined") {
    document.title = "Session | NikCLI"
  }

  return (
    <div class="flex flex-col h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <TitleBar />
      <div class="flex flex-1 overflow-hidden">
        {state().sidebarOpen && <Sidebar />}
        <div class="flex flex-col flex-1">
          <MainContent />
          <PromptInput />
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
