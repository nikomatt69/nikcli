import { createSignal, For, type JSX, Show } from "solid-js"
import { cn } from "../../lib/utils"

interface TabsProps {
  defaultValue: string
  children: JSX.Element
  class?: string
}

export function Tabs(props: TabsProps) {
  const [activeTab, setActiveTab] = createSignal(props.defaultValue)

  return (
    <div class={cn("w-full", props.class)} data-active-tab={activeTab()}>
      {props.children}
    </div>
  )
}

interface TabsListProps {
  children: JSX.Element
  class?: string
}

export function TabsList(props: TabsListProps) {
  return (
    <div
      class={cn(
        "inline-flex h-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 p-1",
        props.class,
      )}
    >
      {props.children}
    </div>
  )
}

interface TabsTriggerProps {
  value: string
  children: JSX.Element
  class?: string
}

export function TabsTrigger(props: TabsTriggerProps) {
  const [isActive, setIsActive] = createSignal(false)

  return (
    <button
      onClick={() => {
        const parent = document.querySelector("[data-active-tab]") as HTMLElement
        if (parent) {
          parent.dataset.activeTab = props.value
        }
      }}
      class={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        isActive()
          ? "bg-white text-gray-950 shadow-sm dark:bg-gray-950 dark:text-gray-50"
          : "text-gray-500 hover:text-gray-950 dark:text-gray-400 dark:hover:text-gray-50",
        props.class,
      )}
    >
      {props.children}
    </button>
  )
}

interface TabsContentProps {
  value: string
  children: JSX.Element
  class?: string
}

export function TabsContent(props: TabsContentProps) {
  const [isActive, setIsActive] = createSignal(false)

  return (
    <Show when={isActive()}>
      <div
        class={cn(
          "mt-2 ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2",
          props.class,
        )}
      >
        {props.children}
      </div>
    </Show>
  )
}
