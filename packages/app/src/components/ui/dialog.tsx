import { createSignal, Show, For, type JSX } from "solid-js"
import { cn } from "../../lib/utils"

interface DialogProps {
  open: boolean
  onClose: () => void
  children: JSX.Element
  class?: string
}

export function Dialog(props: DialogProps) {
  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose()
        }}
      >
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <div
          class={cn(
            "relative z-50 w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl animate-in fade-in zoom-in-95 duration-200",
            props.class,
          )}
        >
          {props.children}
        </div>
      </div>
    </Show>
  )
}

interface DialogHeaderProps {
  children: JSX.Element
  class?: string
}

export function DialogHeader(props: DialogHeaderProps) {
  return <div class={cn("flex flex-col space-y-2 text-center sm:text-left", props.class)}>{props.children}</div>
}

interface DialogTitleProps {
  children: JSX.Element
  class?: string
}

export function DialogTitle(props: DialogTitleProps) {
  return <h2 class={cn("text-lg font-semibold leading-none tracking-tight", props.class)}>{props.children}</h2>
}

interface DialogDescriptionProps {
  children: JSX.Element
  class?: string
}

export function DialogDescription(props: DialogDescriptionProps) {
  return <p class={cn("text-sm text-gray-500 dark:text-gray-400", props.class)}>{props.children}</p>
}

interface DialogFooterProps {
  children: JSX.Element
  class?: string
}

export function DialogFooter(props: DialogFooterProps) {
  return (
    <div class={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6", props.class)}>
      {props.children}
    </div>
  )
}

interface DialogTriggerProps {
  children: JSX.Element
  onClick: () => void
}

export function DialogTrigger(props: DialogTriggerProps) {
  return (
    <div onClick={props.onClick} class="cursor-pointer">
      {props.children}
    </div>
  )
}
