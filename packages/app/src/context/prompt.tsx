import { createContext, useContext, createSignal, createEffect, type JSX } from "solid-js"
import type { Message, Part } from "@nikcli-ai/sdk/v2"
import { useApi } from "./api"
import { useSession } from "./session"
import { useApp } from "./app"

interface PromptContextValue {
  input: () => string
  setInput: (value: string) => void
  messages: () => MessageItem[]
  submit: () => Promise<void>
  refresh: () => Promise<void>
  isProcessing: () => boolean
}

interface MessageItem {
  info: Message
  parts: Part[]
}

const PromptContext = createContext<PromptContextValue>()

export function PromptProvider(props: { children: JSX.Element }) {
  const { sdk, directory } = useApi()
  const { activeSession, createSession } = useSession()
  const { setError } = useApp()
  const [input, setInput] = createSignal("")
  const [messages, setMessages] = createSignal<MessageItem[]>([])
  const [isProcessing, setIsProcessing] = createSignal(false)

  const refresh = async () => {
    const session = activeSession()
    if (!session) {
      setMessages([])
      return
    }
    const dir = directory() || undefined
    const result = await sdk().session.messages({ sessionID: session.id, directory: dir, limit: 200 })
    if (result.error) {
      setError("Failed to load messages.")
      return
    }
    setError(null)
    setMessages(result.data || [])
  }

  const submit = async () => {
    const text = input().trim()
    if (!text) return

    setIsProcessing(true)
    setInput("")

    const current = activeSession()
    const session = current || (await createSession())
    if (!session) {
      setIsProcessing(false)
      return
    }

    const result = await sdk().session.prompt({
      sessionID: session.id,
      directory: directory() || undefined,
      parts: [{ type: "text", text }],
    })

    if (result.error) {
      setError("Failed to send prompt.")
      setIsProcessing(false)
      return
    }

    setError(null)
    await refresh()
    setIsProcessing(false)
  }

  createEffect(() => {
    const current = activeSession()?.id
    if (!current) {
      setMessages([])
      return
    }
    void refresh()
  })

  return (
    <PromptContext.Provider
      value={{
        input,
        setInput,
        messages,
        submit,
        refresh,
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
