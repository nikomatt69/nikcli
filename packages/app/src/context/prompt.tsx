import { createContext, useContext, createSignal, type JSX } from "solid-js"

interface PromptContextValue {
  input: () => string
  setInput: (value: string) => void
  history: () => string[]
  addToHistory: (prompt: string) => void
  submit: () => void
  isProcessing: () => boolean
}

const PromptContext = createContext<PromptContextValue>()

export function PromptProvider(props: { children: JSX.Element }) {
  const [input, setInput] = createSignal("")
  const [history, setHistory] = createSignal<string[]>([])
  const [isProcessing, setIsProcessing] = createSignal(false)

  const addToHistory = (prompt: string) => {
    setHistory((prev) => [...prev, prompt])
  }

  const submit = async () => {
    const value = input()
    if (!value.trim()) return

    setIsProcessing(true)
    addToHistory(value)
    setInput("")

    // TODO: Send to API
    console.log("Submitting:", value)

    setIsProcessing(false)
  }

  return (
    <PromptContext.Provider
      value={{
        input,
        setInput,
        history,
        addToHistory,
        submit,
        isProcessing,
      }}
    >
      {props.children}
    </PromptContext.Provider>
  )
}

export function usePrompt() {
  const context = useContext(PromptContext)
  if (!context) {
    throw new Error("usePrompt must be used within PromptProvider")
  }
  return context
}
