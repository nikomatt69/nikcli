import { createSignal, For, Show, type JSX } from "solid-js"
import { cn } from "../../lib/utils"
import { Button } from "./button"

interface Toast {
  id: string
  title?: string
  description?: string
  variant?: "default" | "success" | "error" | "warning"
  duration?: number
}

interface ToastProps {
  toast: Toast
  onDismiss: () => void
}

function ToastItem(props: ToastProps) {
  const variantClasses = {
    default: "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800",
    success: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
    error: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-green-800",
    warning: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800",
  }

  const iconClasses = {
    default: "ℹ️",
    success: "✅",
    error: "❌",
    warning: "⚠️",
  }

  setTimeout(() => {
    props.onDismiss()
  }, props.toast.duration || 5000)

  return (
    <div
      class={cn(
        "pointer-events-auto relative flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-lg animate-in slide-in-from-bottom-5",
        variantClasses[props.toast.variant || "default"],
      )}
    >
      <span class="text-lg">{iconClasses[props.toast.variant || "default"]}</span>
      <div class="flex-1">
        <Show when={props.toast.title}>
          <h4 class="font-semibold text-sm">{props.toast.title}</h4>
        </Show>
        <Show when={props.toast.description}>
          <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">{props.toast.description}</p>
        </Show>
      </div>
      <button onClick={props.onDismiss} class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
        ×
      </button>
    </div>
  )
}

interface ToastContainerProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

export function ToastContainer(props: ToastContainerProps) {
  return (
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <For each={props.toasts}>
        {(toast) => <ToastItem toast={toast} onDismiss={() => props.onDismiss(toast.id)} />}
      </For>
    </div>
  )
}

// Hook per gestire i toast
export function useToast() {
  const [toasts, setToasts] = createSignal<Toast[]>([])

  const toast = (newToast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { ...newToast, id }])
    return id
  }

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return { toasts, toast, dismiss }
}
