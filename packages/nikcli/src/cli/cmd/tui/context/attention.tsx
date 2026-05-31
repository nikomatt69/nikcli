import { createContext, createSignal, onCleanup, Show, useContext, type ParentProps } from "solid-js"

export type FocusState = "focused" | "blurred" | "unknown"

export type AttentionOptions = {
  sound?: boolean
  volume?: number
}

export type AttentionContext = {
  focus: () => FocusState
}

const ctx = createContext<AttentionContext>()

export function AttentionProvider(
  props: ParentProps<{
    renderer: {
      on(event: "focus" | "blur", listener: () => void): unknown
      off(event: "focus" | "blur", listener: () => void): unknown
    }
  }>,
) {
  const [focus, setFocus] = createSignal<FocusState>("unknown")
  const onFocus = () => setFocus("focused")
  const onBlur = () => setFocus("blurred")
  props.renderer.on("focus", onFocus)
  props.renderer.on("blur", onBlur)
  onCleanup(() => {
    props.renderer.off("focus", onFocus)
    props.renderer.off("blur", onBlur)
  })
  return <ctx.Provider value={{ focus }}>{props.children}</ctx.Provider>
}

export function useAttention(): AttentionContext {
  const value = useContext(ctx)
  if (!value) throw new Error("useAttention must be used within an AttentionProvider")
  return value
}
