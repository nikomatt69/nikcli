import { createSignal, For, Show, type JSX } from "solid-js"
import { cn } from "../../lib/utils"

interface DropdownProps {
  trigger: JSX.Element
  children: JSX.Element
  align?: "start" | "end" | "center"
}

export function Dropdown(props: DropdownProps) {
  const [isOpen, setIsOpen] = createSignal(false)

  return (
    <div class="relative inline-block">
      <div onClick={() => setIsOpen(!isOpen())} class="cursor-pointer">
        {props.trigger}
      </div>
      <Show when={isOpen()}>
        <>
          <div class="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            class={cn(
              "absolute z-50 mt-2 w-56 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800 shadow-lg",
              props.align === "end" && "right-0",
              props.align === "start" && "left-0",
              (!props.align || props.align === "center") && "left-1/2 -translate-x-1/2",
            )}
          >
            {props.children}
          </div>
        </>
      </Show>
    </div>
  )
}

interface DropdownItemProps {
  children: JSX.Element
  onClick?: () => void
  disabled?: boolean
  class?: string
}

export function DropdownItem(props: DropdownItemProps) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      class={cn(
        "flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg last:rounded-b-lg disabled:opacity-50 disabled:cursor-not-allowed",
        props.class,
      )}
    >
      {props.children}
    </button>
  )
}

interface DropdownSeparatorProps {
  class?: string
}

export function DropdownSeparator(props: DropdownSeparatorProps) {
  return <div class={cn("my-1 h-px bg-gray-200 dark:bg-gray-700", props.class)} />
}

interface DropdownLabelProps {
  children: JSX.Element
  class?: string
}

export function DropdownLabel(props: DropdownLabelProps) {
  return (
    <div class={cn("px-4 py-2 text-sm font-semibold text-gray-500 dark:text-gray-400", props.class)}>
      {props.children}
    </div>
  )
}
