import { createSignal, onMount } from "solid-js"

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = createSignal<T>(initialValue)

  onMount(() => {
    const stored = localStorage.getItem(key)
    if (stored) {
      try {
        setValue(() => JSON.parse(stored))
      } catch {
        setValue(() => initialValue)
      }
    }
  })

  const setStoredValue = (newValue: T) => {
    setValue(() => newValue)
    localStorage.setItem(key, JSON.stringify(newValue))
  }

  return [value, setStoredValue] as const
}
