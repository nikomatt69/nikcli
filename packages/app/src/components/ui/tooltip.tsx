import { createSignal, Show, type JSX } from "solid-js"
import { cn } from "../../lib/utils"

interface TooltipProps {
  content: JSX.Element
  children: JSX.Element
  side?: "top" | "bottom" | "left" | "right"
  delay?: number
}

export function Tooltip(props: TooltipProps) {
  const [isVisible, setIsVisible] = createSignal(false)
  let timeoutId: ReturnType<typeof setTimeout>

  const show = () => {
    timeoutId = setTimeout(() => setIsVisible(true), props.delay || 300)
  }

  const hide = () => {
    clearTimeout(timeoutId)
    setIsVisible(false)
  }

  const sideClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }

  return (
    <div class="relative inline-block">
      <div onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
        {props.children}
      </div>
      <Show when={isVisible()}>
        <div
          class={cn(
            "absolute z-50 whitespace-nowrap rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white shadow-lg dark:bg-gray-100 dark:text-gray-900",
            sideClasses[props.side || "top"],
          )}
        >
          {props.content}
        </div>
      </Show>
    </div>
  )
}
