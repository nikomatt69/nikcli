import { createSignal, onCleanup, createEffect } from "solid-js"

export function useDebounce<T>(value: () => T, delay: number = 300) {
  const [debouncedValue, setDebouncedValue] = createSignal<T>(value())

  let timeoutId: ReturnType<typeof setTimeout>

  createEffect(() => {
    clearTimeout(timeoutId)
    const currentValue = value()
    timeoutId = setTimeout(() => {
      setDebouncedValue(() => currentValue)
    }, delay)
  })

  onCleanup(() => clearTimeout(timeoutId))

  return debouncedValue
}
