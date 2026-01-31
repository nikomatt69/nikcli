import { useI18n } from "../../i18n"
import { usePrompt } from "../../context"

export default function PromptInput() {
  const { t } = useI18n()
  const { input, setInput, submit, isProcessing, history } = usePrompt()

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    submit()
  }

  return (
    <div class="border-t bg-white dark:bg-gray-900 p-4">
      <form onSubmit={handleSubmit} class="flex gap-2">
        <input
          type="text"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          placeholder={t("prompt.placeholder")}
          disabled={isProcessing()}
          class="flex-1 px-4 py-2 border rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={isProcessing() || !input().trim()}
          class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isProcessing() ? t("prompt.processing") : t("prompt.send")}
        </button>
      </form>
      {history().length > 0 && (
        <div class="mt-2 text-xs text-gray-500">
          {t("prompt.history")}: {history().length} {t("prompt.messages")}
        </div>
      )}
    </div>
  )
}
