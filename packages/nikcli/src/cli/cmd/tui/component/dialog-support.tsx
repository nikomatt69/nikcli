import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useSupportSession } from "@tui/context/support-session"
import { useToast } from "@tui/ui/toast"
import { buildSupportDocsIndex } from "@/agent/prompt/support-docs"
import type { Part, TextPart } from "@nikcli-ai/sdk/v2"

/**
 * Cross-platform "open URL in the user's default browser" helper. Falls back
 * to a no-op (the caller's UI shows the URL) when no opener is available.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    const { spawn } = await import("bun")
    const cmd =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url]
    const proc = spawn({ cmd, stdout: "ignore", stderr: "ignore" })
    await proc.exited
  } catch {
    // best-effort; the dialog already shows the URL.
  }
}

function Header(props: { title: string; subtitle?: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        {props.title}
      </text>
      {props.subtitle ? <text fg={theme.textMuted}>{props.subtitle}</text> : null}
    </box>
  )
}

function Body(props: { children: string }) {
  const { theme } = useTheme()
  return (
    <text fg={theme.text} attributes={0}>
      {props.children}
    </text>
  )
}

function Footer(props: { left?: string; right?: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
      <text fg={theme.textMuted}>{props.left ?? ""}</text>
      <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
        <text fg={theme.selectedListItemText}>{props.right ?? "Close"}</text>
      </box>
    </box>
  )
}

function useEscapeCloses() {
  const dialog = useDialog()
  useKeyboard((evt) => {
    if (evt.name === "escape" || evt.name === "return") {
      evt.preventDefault()
      dialog.clear()
    }
  })
}

export function DialogQuickstartInfo() {
  useEscapeCloses()
  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <Header title="Quickstart" subtitle="60-second first-time tour" />
      <Body
        children={
          "Run `nikcli quickstart` in your shell. It walks you through:\n  1. Connecting a provider (or skipping)\n  2. Picking a starter action\n  3. Launching the TUI, a one-shot prompt, or a model browser\n\nThe quickstart re-execs into the chosen command, so you don't have to copy/paste."
        }
      />
      <Footer left="Tip: type /quickstart in the TUI to launch the same flow" />
    </box>
  )
}

export function DialogDoctorInfo() {
  useEscapeCloses()
  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <Header title="Doctor" subtitle="diagnose common setup issues" />
      <Body
        children={
          "Run `nikcli doctor` in your shell. It checks:\n  - Version & runtime\n  - TTY (warns when piped)\n  - PATH (suggests fix if the exec dir is missing)\n  - Disk space (warns when < 5% free)\n  - Config validity (JSON parse)\n  - Deprecated config keys (e.g. `keybinds` → `keymappings`)\n\nUse --json for a structured report."
        }
      />
      <Footer left="Tip: type /doctor in the TUI to launch the same flow" />
    </box>
  )
}

// =============================================================================
// DialogSupport — chat with the read-only documentation assistant.
// =============================================================================

type ChatMessage = {
  /** Stable id; for streaming assistant messages this is the messageID. */
  id: string
  role: "user" | "assistant"
  text: string
  time: number
  /** True while the assistant is still streaming this message. */
  pending?: boolean
  /** Set if sending or streaming failed for this message. */
  error?: string
}

const WELCOME_HINTS: ReadonlyArray<{ title: string; prompt: string }> = [
  { title: "Cambio modello", prompt: "Come cambio il modello predefinito?" },
  {
    title: "Agent vs sessione",
    prompt: "Cos'è un agent in nikcli e come ne scelgo uno?",
  },
  {
    title: "Keybind utili",
    prompt: "Quali sono le scorciatoie da tastiera principali?",
  },
  {
    title: "Slash commands",
    prompt: "Quali slash command esistono e cosa fanno?",
  },
  { title: "MCP server", prompt: "Come aggiungo un MCP server?" },
  { title: "Skills", prompt: "Cosa sono le skill e come le uso?" },
]

function timeLabel(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function DialogSupport() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()
  const local = useLocal()
  const sync = useSync()
  const toast = useToast()
  const support = useSupportSession()
  const dimensions = useTerminalDimensions()

  // Resolved dialog state ----------------------------------------------------

  const [messages, setMessages] = createSignal<ChatMessage[]>([])
  const [busy, setBusy] = createSignal(false)
  const [initError, setInitError] = createSignal<string | null>(null)
  const [ready, setReady] = createSignal(false)
  /** True while we still expect a "session.idle" event after the last send. */
  const [streaming, setStreaming] = createSignal(false)
  /** The current assistant messageID we are appending to (null if not streaming). */
  const [streamingID, setStreamingID] = createSignal<string | null>(null)

  let scroll: ScrollBoxRenderable | undefined
  let textarea: TextareaRenderable | undefined
  let abort: AbortController | null = null

  const msgHeight = createMemo(() => Math.max(8, Math.min(20, dimensions().height - 16)))

  // Helpers ------------------------------------------------------------------

  function appendOrUpdateMessage(next: ChatMessage) {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === next.id)
      if (idx === -1) return [...prev, next]
      const copy = prev.slice()
      copy[idx] = { ...copy[idx], ...next }
      return copy
    })
  }

  function appendTextToMessage(id: string, text: string) {
    if (!text) return
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id)
      if (idx === -1) {
        return [...prev, { id, role: "assistant", text, time: Date.now(), pending: true }]
      }
      const copy = prev.slice()
      copy[idx] = { ...copy[idx], text: copy[idx].text + text }
      return copy
    })
  }

  function finalizeMessage(id: string) {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id)
      if (idx === -1) return prev
      const copy = prev.slice()
      copy[idx] = { ...copy[idx], pending: false }
      return copy
    })
  }

  // Lifecycle ----------------------------------------------------------------

  onMount(async () => {
    dialog.setSize("xlarge")
    abort = new AbortController()

    try {
      const sessionID = await support.ensure()
      // Load history (latest 100 messages)
      const history = await sdk.client.session.messages({ sessionID }, { signal: abort.signal }).catch(() => null)
      const list = history?.data ?? []
      const initial: ChatMessage[] = []
      for (const entry of list) {
        const text = (entry.parts ?? [])
          .filter((p): p is TextPart => p?.type === "text")
          .map((p) => p.text ?? "")
          .join("")
        if (!text && entry.info.role === "assistant") continue
        initial.push({
          id: entry.info.id,
          role: entry.info.role,
          text,
          time: entry.info.time?.created ?? Date.now(),
        })
      }
      setMessages(initial)
      setReady(true)

      // Subscribe to live events for this session.
      const offPart = sdk.event.on("message.part.updated" as never, (evt: any) => {
        if (!evt?.properties?.part) return
        const part: Part = evt.properties.part
        if (part.sessionID !== sessionID) return
        if (part.type !== "text") return
        const id = part.messageID
        if (!id) return
        if (id !== streamingID() && !messages().some((m) => m.id === id)) {
          // New assistant message we didn't see the start of: create it.
          setStreamingID(id)
          setStreaming(true)
        }
        // Prefer the accumulated `text` field if present (server may send the
        // full state); otherwise append the delta.
        const full = (part as TextPart).text
        const delta: string | undefined = evt.properties.delta
        if (typeof full === "string" && full.length > 0) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === id)
            if (idx === -1) {
              return [
                ...prev,
                {
                  id,
                  role: "assistant",
                  text: full,
                  time: Date.now(),
                  pending: true,
                },
              ]
            }
            const copy = prev.slice()
            copy[idx] = { ...copy[idx], text: full }
            return copy
          })
        } else if (delta) {
          appendTextToMessage(id, delta)
        }
      })

      const offIdle = sdk.event.on("session.idle" as never, (evt: any) => {
        if (evt?.properties?.sessionID !== sessionID) return
        const id = streamingID()
        if (id) finalizeMessage(id)
        batch(() => {
          setStreamingID(null)
          setStreaming(false)
          setBusy(false)
        })
        abort?.abort()
        abort = null
        // Refocus the textarea for the next turn.
        setTimeout(() => textarea?.focus(), 30)
      })

      const offError = sdk.event.on("session.error" as never, (evt: any) => {
        if (evt?.properties?.sessionID !== sessionID) return
        const message = evt?.properties?.error?.data?.message ?? "Unknown error from support agent"
        const id = streamingID()
        if (id) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === id)
            if (idx === -1) return prev
            const copy = prev.slice()
            copy[idx] = { ...copy[idx], pending: false, error: message }
            return copy
          })
        } else {
          setInitError(message)
        }
        batch(() => {
          setStreamingID(null)
          setStreaming(false)
          setBusy(false)
        })
        toast.show({ message, variant: "error", duration: 6000 })
      })

      onCleanup(() => {
        offPart()
        offIdle()
        offError()
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setInitError(msg)
      setReady(true)
    }
  })

  onCleanup(() => {
    abort?.abort()
  })

  // Auto-scroll on message changes
  createEffect(
    on(
      () => messages().length,
      () => {
        setTimeout(() => {
          if (scroll && !scroll.isDestroyed) scroll.scrollTo(scroll.scrollHeight)
        }, 5)
      },
    ),
  )
  // And when text updates within the last message
  createEffect(
    on(
      () => {
        const m = messages().at(-1)
        return m ? `${m.id}:${m.text.length}` : ""
      },
      () => {
        setTimeout(() => {
          if (scroll && !scroll.isDestroyed) scroll.scrollTo(scroll.scrollHeight)
        }, 5)
      },
    ),
  )

  // Focus the textarea on mount once ready
  createEffect(() => {
    if (ready() && textarea && !textarea.isDestroyed && !textarea.focused) {
      setTimeout(() => textarea?.focus(), 30)
    }
  })

  // Send ---------------------------------------------------------------------

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy()) return
    const sessionID = support.id
    if (!sessionID) {
      setInitError("Support session not ready — try again in a moment.")
      return
    }
    const model = local.model.current()
    if (!model) {
      toast.show({
        message: "No provider connected. Connect one in /providers first.",
        variant: "warning",
        duration: 5000,
      })
      return
    }

    // Build system prompt (lazy: the docs index is cached in-process).
    const cwd = sdk.directory ?? process.cwd()
    const docsIndex = await buildSupportDocsIndex(cwd).catch(() => "")

    // Optimistic user message
    const localId = `local-${Date.now()}`
    appendOrUpdateMessage({
      id: localId,
      role: "user",
      text: trimmed,
      time: Date.now(),
    })
    batch(() => {
      setBusy(true)
      setInitError(null)
    })

    try {
      await sdk.client.session
        .prompt({
          sessionID,
          agent: "support",
          model,
          system: docsIndex || undefined,
          parts: [{ type: "text", text: trimmed }],
        })
        .catch((err) => {
          throw err
        })
      // The actual assistant text arrives via SSE "message.part.updated" events.
      // We don't await here because the call returns once the user message is
      // accepted; the assistant streams asynchronously.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === localId)
        if (idx === -1) return prev
        const copy = prev.slice()
        copy[idx] = { ...copy[idx], error: msg }
        return copy
      })
      toast.show({
        message: `Failed to send: ${msg}`,
        variant: "error",
        duration: 5000,
      })
      setBusy(false)
    }
  }

  async function resetConversation() {
    if (busy()) return
    await support.reset()
    setMessages([])
    setInitError(null)
    toast.show({
      message: "Support conversation reset.",
      variant: "info",
      duration: 2000,
    })
  }

  // Keyboard -----------------------------------------------------------------

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault()
      dialog.clear()
      return
    }
    // Ctrl+L — clear conversation
    if (evt.ctrl && evt.name === "l") {
      resetConversation().catch(() => {})
      evt.preventDefault()
      return
    }
  })

  // Render -------------------------------------------------------------------

  const agentName = createMemo(() => {
    const a = sync.data.agent.find((x) => x.name === "support")
    return a?.name ?? "support"
  })
  const modelName = createMemo(() => {
    const m = local.model.parsed()
    return `${m.provider} / ${m.model}`
  })

  return (
    <box gap={1} paddingBottom={1}>
      {/* Header */}
      <box paddingLeft={2} paddingRight={2}>
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" gap={1}>
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              Support
            </text>
            <text fg={theme.textMuted}>@{agentName()}</text>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.textMuted}>{modelName()}</text>
          </box>
          <text fg={theme.textMuted}>{streaming() ? "● risponde" : busy() ? "● invio" : "esc close"}</text>
        </box>
      </box>

      {/* Messages */}
      <scrollbox
        maxHeight={msgHeight()}
        scrollbarOptions={{ visible: false }}
        ref={(r: ScrollBoxRenderable) => {
          scroll = r
        }}
        paddingLeft={2}
        paddingRight={2}
      >
        <Show when={!ready()}>
          <text fg={theme.textMuted}>Caricamento della sessione support…</text>
        </Show>
        <Show when={ready() && messages().length === 0}>
          <WelcomeHints onPick={(p) => send(p)} />
        </Show>
        <Show when={initError()}>
          <box paddingBottom={1}>
            <text fg={theme.error}>{initError()}</text>
          </box>
        </Show>
        <For each={messages()}>{(m) => <MessageRow msg={m} />}</For>
        <Show when={streaming() && messages().at(-1)?.role !== "assistant"}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              support
            </text>
            <text fg={theme.textMuted}>sta scrivendo…</text>
          </box>
        </Show>
      </scrollbox>

      {/* Input */}
      <box paddingLeft={2} paddingRight={2} gap={1} paddingTop={1}>
        <textarea
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          onSubmit={() => {
            const value = textarea?.plainText ?? ""
            if (value.trim() && !busy()) {
              send(value)
              textarea?.clear()
            }
          }}
          ref={(r: TextareaRenderable) => {
            textarea = r
          }}
          placeholder={
            busy() ? "Support sta rispondendo — attendi..." : "Chiedi a Support… (es. 'come cambio modello?')"
          }
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.primary }}>enter</span> invia · <span style={{ fg: theme.primary }}>ctrl+l</span>{" "}
          nuova conversazione · <span style={{ fg: theme.primary }}>esc</span> chiudi
        </text>
      </box>
    </box>
  )
}

// =============================================================================
// Subcomponents
// =============================================================================

function MessageRow(props: { msg: ChatMessage }) {
  const { theme } = useTheme()
  const m = props.msg
  return (
    <box paddingBottom={1} flexDirection="column" gap={0}>
      <box flexDirection="row" gap={1}>
        <text fg={m.role === "user" ? theme.primary : theme.accent} attributes={TextAttributes.BOLD}>
          {m.role === "user" ? "tu" : "support"}
        </text>
        <text fg={theme.textMuted}>{timeLabel(m.time)}</text>
        <Show when={m.pending}>
          <text fg={theme.textMuted}>…</text>
        </Show>
        <Show when={m.error}>
          <text fg={theme.error}>! {m.error}</text>
        </Show>
      </box>
      <text fg={theme.text} wrapMode="word">
        {m.text || (m.pending ? " " : "")}
      </text>
    </box>
  )
}

function WelcomeHints(props: { onPick: (prompt: string) => void }) {
  const { theme } = useTheme()
  return (
    <box gap={1} flexDirection="column" paddingBottom={1}>
      <text fg={theme.text}>
        Ciao! Sono <span style={{ fg: theme.accent }}>Support</span>, l'assistente documentazione di nikcli.
      </text>
      <text fg={theme.textMuted}>
        Posso rispondere a domande su comandi, configurazione, agent, MCP, keybind, flussi di lavoro e troubleshooting.
        Rispondo in italiano o inglese a seconda della tua lingua.
      </text>
      <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
        Esempi:
      </text>
      <For each={WELCOME_HINTS}>
        {(hint) => (
          <box
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
            onMouseUp={() => props.onPick(hint.prompt)}
            backgroundColor={theme.backgroundPanel}
          >
            <text fg={theme.text}>
              <span style={{ fg: theme.accent }}>›</span> {hint.title}
              <span style={{ fg: theme.textMuted }}> — {hint.prompt}</span>
            </text>
          </box>
        )}
      </For>
    </box>
  )
}

// (end of file)
