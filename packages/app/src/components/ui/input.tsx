import { splitProps, type JSX, Show, For } from "solid-js"
import { cn } from "../../lib/utils"

interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  error?: string
  label?: string
}

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, ["error", "label", "class"])

  return (
    <div class="w-full">
      <Show when={local.label}>
        <label class="block text-sm font-medium mb-1.5 text-gray-900 dark:text-gray-100">{local.label}</label>
      </Show>
      <input
        class={cn(
          "flex h-10 w-full rounded-lg border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50",
          local.error && "border-red-500 focus:ring-red-500",
          local.class,
        )}
        {...rest}
      />
      <Show when={local.error}>
        <p class="mt-1.5 text-sm text-red-500">{local.error}</p>
      </Show>
    </div>
  )
}

interface TextareaProps extends JSX.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string
  label?: string
}

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, ["error", "label", "class"])

  return (
    <div class="w-full">
      <Show when={local.label}>
        <label class="block text-sm font-medium mb-1.5 text-gray-900 dark:text-gray-100">{local.label}</label>
      </Show>
      <textarea
        class={cn(
          "flex min-h-[80px] w-full rounded-lg border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50",
          local.error && "border-red-500 focus:ring-red-500",
          local.class,
        )}
        {...rest}
      />
      <Show when={local.error}>
        <p class="mt-1.5 text-sm text-red-500">{local.error}</p>
      </Show>
    </div>
  )
}

interface SelectProps extends JSX.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string
  label?: string
  options: { value: string; label: string }[]
}

export function Select(props: SelectProps) {
  const [local, rest] = splitProps(props, ["error", "label", "options", "class"])

  return (
    <div class="w-full">
      <Show when={local.label}>
        <label class="block text-sm font-medium mb-1.5 text-gray-900 dark:text-gray-100">{local.label}</label>
      </Show>
      <select
        class={cn(
          "flex h-10 w-full rounded-lg border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50",
          local.error && "border-red-500 focus:ring-red-500",
          local.class,
        )}
        {...rest}
      >
        <For each={local.options}>{(option) => <option value={option.value}>{option.label}</option>}</For>
      </select>
      <Show when={local.error}>
        <p class="mt-1.5 text-sm text-red-500">{local.error}</p>
      </Show>
    </div>
  )
}
